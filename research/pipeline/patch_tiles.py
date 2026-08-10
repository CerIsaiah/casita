"""Swap the hand-drawn grid for real map tiles.

CARTO Positron is free, needs no key, and is built as a backdrop for data
overlays. Requires switching to Web Mercator so tiles and markers line up.
"""
p = "app.js"
s = open(p, encoding="utf-8").read()

start = s.index("/* ---------- map ---------- */")
end = s.index("/* ---------- interactions ---------- */")

MAP = '''/* ---------- map ---------- */
/* Real tiles, Web Mercator. CARTO Positron: free, no key, built for overlays. */
const cvs = document.getElementById("map"), mx = cvs.getContext("2d");
let MW=0, MH=0, ZOOM=13.4, CX=-122.4260, CY=37.7680, mapLayer="listings";
const GRID = (typeof STREET_GRID!=="undefined") ? STREET_GRID : {};
const TILE = 256, TILE_URL = z => `https://basemaps.cartocdn.com/light_all/${z}/{x}/{y}.png`;

function sizeMap(){
  const r = cvs.getBoundingClientRect(), d = Math.min(devicePixelRatio||1, 2);
  if (!r.width) return;
  MW = r.width; MH = r.height; cvs.width = MW*d; cvs.height = MH*d;
  mx.setTransform(d,0,0,d,0,0);
}
/* world pixel coords at the current zoom */
const scaleN = () => TILE * Math.pow(2, ZOOM);
function worldX(lon){ return (lon + 180) / 360 * scaleN(); }
function worldY(lat){
  const s = Math.sin(lat * Math.PI/180);
  return (0.5 - Math.log((1+s)/(1-s)) / (4*Math.PI)) * scaleN();
}
function lonAt(x){ return x / scaleN() * 360 - 180; }
function latAt(y){
  const n = Math.PI - 2*Math.PI*y/scaleN();
  return 180/Math.PI * Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));
}
function proj(lat, lon){
  return [worldX(lon) - worldX(CX) + MW/2, worldY(lat) - worldY(CY) + MH/2];
}

/* tile cache */
const tiles = new Map();
function getTile(z, x, y){
  const k = `${z}/${x}/${y}`;
  if (tiles.has(k)) return tiles.get(k);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => { img._ok = true; requestAnimationFrame(drawMap); };
  img.onerror = () => { img._bad = true; };
  img.src = TILE_URL(z).replace("{x}", x).replace("{y}", y);
  tiles.set(k, img);
  if (tiles.size > 600){                     // keep the cache from growing forever
    for (const key of tiles.keys()){ tiles.delete(key); if (tiles.size <= 500) break; }
  }
  return img;
}

function drawTiles(){
  const z = Math.max(1, Math.min(19, Math.round(ZOOM)));
  const n = Math.pow(2, z);
  const scaleAdj = scaleN() / (TILE * n);     // fractional zoom -> draw scaled tiles
  const size = TILE * scaleAdj;
  const originX = worldX(CX) - MW/2, originY = worldY(CY) - MH/2;
  const x0 = Math.floor(originX / size), x1 = Math.floor((originX + MW) / size);
  const y0 = Math.floor(originY / size), y1 = Math.floor((originY + MH) / size);
  for (let x = x0; x <= x1; x++){
    for (let y = y0; y <= y1; y++){
      if (y < 0 || y >= n) continue;
      const img = getTile(z, ((x % n) + n) % n, y);
      if (img._ok){
        mx.drawImage(img, x*size - originX, y*size - originY, size+1, size+1);
      }
    }
  }
}

function drawMap(){
  sizeMap(); if (!MW) return;
  mx.clearRect(0,0,MW,MH);
  mx.fillStyle = "#E8E4DE"; mx.fillRect(0,0,MW,MH);
  drawTiles();

  const HEAT = {encampment:"180,110,40", break_in:"150,60,90",
                violent:"170,45,45", cleaning:"120,120,90"};
  if (HEAT[mapLayer] && GRID[mapLayer]){
    const cells = GRID[mapLayer];
    const top = Math.max(...cells.map(c=>c[2]));
    mx.globalCompositeOperation = "multiply";
    for (const [la,lo,cnt] of cells){
      const q = proj(la,lo);
      if (q[0]<-40||q[0]>MW+40||q[1]<-40||q[1]>MH+40) continue;
      const f = Math.sqrt(cnt/top);
      const r = (10 + 20*f) * Math.max(0.55, Math.pow(2, ZOOM-13.4)*0.9);
      const g = mx.createRadialGradient(q[0],q[1],0,q[0],q[1],r);
      g.addColorStop(0,`rgba(${HEAT[mapLayer]},${0.07+f*0.45})`);
      g.addColorStop(1,`rgba(${HEAT[mapLayer]},0)`);
      mx.fillStyle=g; mx.beginPath(); mx.arc(q[0],q[1],r,0,7); mx.fill();
    }
    mx.globalCompositeOperation = "source-over";
  }
  if (mapLayer === "dark"){
    mx.globalCompositeOperation = "multiply";
    for (const a of visible()){
      if (a.venues < 4) continue;
      const q = proj(a.lat,a.lon);
      const r = (14 + a.venues*1.4) * Math.max(0.55, Math.pow(2, ZOOM-13.4)*0.9);
      const g = mx.createRadialGradient(q[0],q[1],0,q[0],q[1],r);
      g.addColorStop(0,`rgba(228,98,42,${cl(a.venues/40,0,1)*0.45})`);
      g.addColorStop(1,"rgba(228,98,42,0)");
      mx.fillStyle=g; mx.beginPath(); mx.arc(q[0],q[1],r,0,7); mx.fill();
    }
    mx.globalCompositeOperation = "source-over";
  }
  /* attribution — required by CARTO and OSM */
  mx.font = "10px -apple-system,system-ui,sans-serif";
  const cred = "© OpenStreetMap contributors © CARTO";
  const w = mx.measureText(cred).width;
  mx.fillStyle = "rgba(255,255,255,.78)";
  mx.fillRect(MW-w-12, MH-16, w+10, 14);
  mx.fillStyle = "#6B6B6B";
  mx.fillText(cred, MW-w-7, MH-6);
}

function placePins(){
  const layer = document.getElementById("pins");
  const v = visible();
  const chosen = [], grid = new Set();
  const selA = v.find(a=>a.id===sel);
  if (selA) chosen.push(selA);
  for (const a of v){
    if (a.id === sel) continue;
    const q = proj(a.lat,a.lon);
    if (q[0]<-40||q[0]>MW+40||q[1]<-30||q[1]>MH+30) continue;
    const k = `${Math.round(q[0]/74)},${Math.round(q[1]/38)}`;
    if (grid.has(k)) continue;
    grid.add(k); chosen.push(a);
    if (chosen.length > 42) break;
  }
  layer.innerHTML = chosen.map(a=>{
    const q = proj(a.lat,a.lon);
    const val = F.showActual ? a.act[0] : a.rent;
    const lbl = val >= 1000 ? `$${(val/1000).toFixed(2)}k` : `$${val}`;
    return `<button class="mpin ${a.id===sel?'sel':''}" data-pin="${a.id}"
      style="left:${q[0]}px;top:${q[1]}px">${lbl}</button>`;
  }).join("");
}

(function(){
  let down=false,lx=0,ly=0;
  cvs.addEventListener("mousedown",e=>{down=true;lx=e.clientX;ly=e.clientY;cvs.classList.add("drag")});
  addEventListener("mousemove",e=>{
    if(!down) return;
    const wx = worldX(CX) - (e.clientX-lx), wy = worldY(CY) - (e.clientY-ly);
    CX = lonAt(wx); CY = latAt(wy);
    lx=e.clientX; ly=e.clientY; drawMap(); placePins();
  });
  addEventListener("mouseup",()=>{down=false;cvs.classList.remove("drag")});
  cvs.addEventListener("wheel",e=>{
    e.preventDefault();
    const r = cvs.getBoundingClientRect();
    const px = e.clientX-r.left, py = e.clientY-r.top;
    const latB = latAt(worldY(CY)-MH/2+py), lonB = lonAt(worldX(CX)-MW/2+px);
    ZOOM = cl(ZOOM + (e.deltaY<0 ? 0.4 : -0.4), 10.5, 18);
    // keep the point under the cursor fixed
    CX = lonAt(worldX(lonB) - (px - MW/2));
    CY = latAt(worldY(latB) - (py - MH/2));
    drawMap(); placePins();
  },{passive:false});
  const zoomBy = d => { ZOOM = cl(ZOOM+d, 10.5, 18); drawMap(); placePins(); };
  document.getElementById("zin").onclick = ()=>zoomBy(0.7);
  document.getElementById("zout").onclick = ()=>zoomBy(-0.7);
})();
addEventListener("resize",()=>{drawMap();placePins()});

'''
s = s[:start] + MAP + s[end:]
open(p, "w", encoding="utf-8").write(s)
print("real tiles wired (Web Mercator)")
