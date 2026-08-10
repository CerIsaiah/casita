#!/usr/bin/env python3
"""Build a walkable street graph for San Francisco, small enough to ship.

Every route this product used to draw was invented. The commute lines bent
along a formula that approximated the street grid, and the walk loops placed
their corners by arithmetic. Both looked like directions and neither was, which
is the same false precision as a six-minute walk measured from a neighbourhood
centroid.

This replaces the formula with the actual footways.

On where the data comes from: the first version of this file asked Overpass for
twenty-five tiles and grew three mirrors, a retry ladder and a disk cache
trying to survive the throttling. It still died at tile 15 with every mirror
refusing, twice, and it quietly cached two empty responses as though the
Mission and the Sunset had no streets in them. That is a great deal of
machinery for downloading a map somebody already publishes as one file. BBBike
cuts a San Francisco extract nightly, it is 72MB gzipped, it arrives in one
request, and nobody rate-limits it.

Size is the other problem. The raw geometry is around half a million vertices,
and a page already carrying 2,600 listings cannot also carry six megabytes of
coordinates. So the graph is contracted: routing only needs decisions, and a
decision only happens at a junction, so every node with exactly two neighbours
is interior to one stretch of pavement and folds into the edge containing it.
The shape is kept as that edge's polyline, so a drawn route still follows the
real bend of the street -- it *is* the street -- while the search space
collapses to junctions.

Coordinates quantise to 1e-5 degrees, about a metre, finer than any pin here is
worth, and every SF coordinate then fits in a uint16 offset.

    python3 build_walk_graph.py          -> walk_graph.json
"""
import collections
import gzip
import json
import math
import os
import pathlib
import urllib.request
import xml.etree.ElementTree as ET

EXTRACT_URL = "https://download.bbbike.org/osm/bbbike/SanFrancisco/SanFrancisco.osm.gz"
EXTRACT = pathlib.Path("sf.osm.gz")

# The city proper. The extract covers more of the peninsula than we rank in.
S, W, N, E = 37.700, -122.525, 37.842, -122.350
QUANT = 1e-5

# What a person on foot can actually use. Motorways and their slip roads are
# excluded: routing a walk down US-101 would be worse than a straight line.
WALKABLE = {
    "footway", "path", "pedestrian", "steps", "living_street", "residential",
    "unclassified", "service", "tertiary", "tertiary_link", "secondary",
    "secondary_link", "primary", "primary_link", "track", "corridor",
}

# A car cannot use a staircase. The graph used to be one undifferentiated
# network, which was fine while only walking was routed and would have sent a
# driving route down a footpath the moment one was asked for. Each edge now
# carries whether it is drivable, and the router filters on it.
DRIVABLE = {
    "living_street", "residential", "unclassified", "service", "tertiary",
    "tertiary_link", "secondary", "secondary_link", "primary", "primary_link",
}


def download():
    if EXTRACT.exists() and EXTRACT.stat().st_size > 1_000_000:
        print(f"using cached {EXTRACT} ({EXTRACT.stat().st_size / 1048576:.0f} MB)")
        return
    print("downloading the San Francisco extract…", flush=True)
    urllib.request.urlretrieve(EXTRACT_URL, EXTRACT)
    print(f"  {EXTRACT.stat().st_size / 1048576:.0f} MB", flush=True)


def key(lat, lon):
    return (round(lat / QUANT), round(lon / QUANT))


M_LAT = 110540.0


def metres(a, b):
    la1, lo1 = a[0] * QUANT, a[1] * QUANT
    la2, lo2 = b[0] * QUANT, b[1] * QUANT
    x = (lo2 - lo1) * 111320.0 * math.cos(math.radians(la1))
    return math.hypot(x, (la2 - la1) * M_LAT)


def read_extract():
    """One streaming pass for nodes, one for ways.

    iterparse with element clearing keeps this to a few hundred MB of RSS on a
    72MB gzip; building the whole DOM would not fit.
    """
    coords = {}
    print("pass 1: nodes", flush=True)
    with gzip.open(EXTRACT, "rb") as f:
        for _ev, el in ET.iterparse(f, events=("end",)):
            if el.tag == "node":
                la, lo = float(el.get("lat")), float(el.get("lon"))
                if S <= la <= N and W <= lo <= E:
                    coords[el.get("id")] = (la, lo)
            if el.tag in ("node", "way", "relation"):
                el.clear()
    print(f"  {len(coords):,} nodes inside the city box", flush=True)

    ways = []
    print("pass 2: ways", flush=True)
    with gzip.open(EXTRACT, "rb") as f:
        for _ev, el in ET.iterparse(f, events=("end",)):
            if el.tag == "way":
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                if tags.get("highway") in WALKABLE and tags.get("foot") != "no" \
                        and tags.get("access") not in ("private", "no"):
                    pts = [coords[r] for r in
                           (nd.get("ref") for nd in el.findall("nd")) if r in coords]
                    if len(pts) > 1:
                        ways.append((pts, tags["highway"] in DRIVABLE))
            if el.tag in ("node", "way", "relation"):
                el.clear()
    print(f"  {len(ways):,} walkable ways", flush=True)
    return ways


def main():
    download()
    ways = read_extract()

    # ---- full node graph, deduplicated on the quantised coordinate
    adj = collections.defaultdict(set)
    drivable = {}                      # (a, b) -> can a car use this segment
    for pts, drive in ways:
        q = [key(la, lo) for la, lo in pts]
        q = [p for i, p in enumerate(q) if i == 0 or p != q[i - 1]]
        for a, b in zip(q, q[1:]):
            adj[a].add(b)
            adj[b].add(a)
            # A segment shared by a footpath and a road is drivable; the road
            # is the permissive fact.
            drivable[(a, b)] = drivable.get((a, b), False) or drive
            drivable[(b, a)] = drivable[(a, b)]
    print(f"\nraw graph: {len(adj):,} nodes, "
          f"{sum(len(v) for v in adj.values()) // 2:,} segments")

    # ---- contract every degree-2 node into the edge running through it
    junction = {n for n, nb in adj.items() if len(nb) != 2}
    print(f"junctions (degree != 2): {len(junction):,}")

    edges, walked = [], set()
    for j in junction:
        for first in adj[j]:
            if (j, first) in walked:
                continue
            prev, cur = j, first
            path, dist = [], metres(j, first)
            # A contracted edge is drivable only if every segment in it is.
            drive_ok = drivable.get((j, first), False)
            walked.add((j, first))
            while cur not in junction:
                nxt = next((x for x in adj[cur] if x != prev), None)
                if nxt is None:
                    break
                path.append(cur)
                dist += metres(cur, nxt)
                drive_ok = drive_ok and drivable.get((cur, nxt), False)
                walked.add((cur, nxt)); walked.add((nxt, cur))
                prev, cur = cur, nxt
            walked.add((cur, prev))
            if cur == j and not path:
                continue
            edges.append((j, cur, path, dist, drive_ok))
    print(f"contracted edges: {len(edges):,}")

    # ---- keep the largest connected component
    nodes = sorted(junction)
    idx = {n: i for i, n in enumerate(nodes)}
    nbr = collections.defaultdict(list)
    for a, b, _p, _d, _dr in edges:
        if a in idx and b in idx:
            nbr[idx[a]].append(idx[b]); nbr[idx[b]].append(idx[a])
    best, seen = set(), set()
    for start in range(len(nodes)):
        if start in seen:
            continue
        comp, stack = set(), [start]
        while stack:
            v = stack.pop()
            if v in comp:
                continue
            comp.add(v)
            stack.extend(x for x in nbr[v] if x not in comp)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    print(f"largest connected component: {len(best):,} of {len(nodes):,}")

    keep = sorted(best)
    remap = {old: i for i, old in enumerate(keep)}
    out_nodes = [nodes[i] for i in keep]
    out_edges = [(remap[idx[a]], remap[idx[b]], path, round(dist), dr)
                 for a, b, path, dist, dr in edges
                 if idx.get(a) in remap and idx.get(b) in remap]

    # ---- write it small
    lat0, lon0 = round(S / QUANT), round(W / QUANT)
    flat_nodes = []
    for la, lo in out_nodes:
        flat_nodes += [la - lat0, lo - lon0]

    flat_edges, geom, geom_ix, drive_flags = [], [], [], []
    for a, b, path, dist, dr in out_edges:
        flat_edges += [a, b, dist]
        drive_flags.append(1 if dr else 0)
        geom_ix.append(len(geom) // 2)
        for la, lo in path:
            geom += [la - lat0, lo - lon0]
    geom_ix.append(len(geom) // 2)

    doc = {"quant": QUANT, "lat0": lat0, "lon0": lon0,
           "nodes": flat_nodes, "edges": flat_edges, "drive": drive_flags,
           "geomIx": geom_ix, "geom": geom}
    with open("walk_graph.json", "w") as f:
        json.dump(doc, f, separators=(",", ":"))

    # Ship it compressed. 4.3MB of JSON is 1.5MB gzipped, and serve.py sets
    # Content-Encoding so the browser inflates it without any code here.
    import gzip as _gz, shutil
    served = pathlib.Path("..") / "walk_graph.json.gz"
    with open("walk_graph.json", "rb") as src, _gz.open(served, "wb", 9) as dst:
        shutil.copyfileobj(src, dst)

    mb = os.path.getsize("walk_graph.json") / 1e6
    gz = served.stat().st_size / 1e6
    print(f"  served as {served.name}: {gz:.2f} MB")
    print(f"\nwalk_graph.json  {len(out_nodes):,} junctions · "
          f"{len(out_edges):,} edges ({sum(drive_flags):,} drivable) · "
          f"{len(geom)//2:,} shape points")
    print(f"  {mb:.2f} MB on disk")


if __name__ == "__main__":
    main()
