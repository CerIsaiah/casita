/* icons.js — one drawn set, instead of whatever the emoji font decides.
   ============================================================
   Emoji were placeholder thinking. They ship a different drawing on every
   platform, they carry colour we did not choose, they sit on the baseline
   wrong, and a row of them reads as decoration rather than as an interface.
   The tell is that 🌉 and 🎸 were standing in for "Marina" and "the Haight" —
   which is a joke, not a label.

   These are the same thing every icon in the header already was: a 24-grid,
   1.7px stroke, round caps, currentColor. They inherit type colour, so they
   work in both themes for free and go orange when their chip is selected.

   Kept deliberately small. An icon set that needs a search box is a design
   problem, not a design system. */

const ICON = (() => {
  "use strict";

  const P = {
    // navigation / tabs
    compass:  '<circle cx="12" cy="12" r="9"/><path d="m15.2 8.8-2 4.4-4.4 2 2-4.4Z"/>',
    moon:     '<path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10Z"/>',
    shield:   '<path d="M12 3.5 19 6v6c0 4-3 7.2-7 8.5-4-1.3-7-4.5-7-8.5V6Z"/>',
    search:   '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    people:   '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 11a3 3 0 1 0 0-6M21 20a5 5 0 0 0-4-4.9"/>',

    // priorities
    money:    '<path d="M12 3.5v17"/><path d="M16 7.5c-.6-1.3-2.1-2-4-2-2.2 0-3.6 1.1-3.6 2.6 0 3.6 7.8 2.2 7.8 6 0 1.7-1.6 2.9-4.2 2.9-2 0-3.6-.8-4.2-2.2"/>',
    ruler:    '<path d="M4 15.5 15.5 4l4.5 4.5L8.5 20Z"/><path d="m8 11.5 1.8 1.8M11 8.5l1.8 1.8"/>',
    wrench:   '<path d="M15.5 4.5a4.5 4.5 0 0 0-5.9 5.6L4 15.6V20h4.4l5.5-5.6a4.5 4.5 0 0 0 5.6-5.9L17 11l-2.5-.5L14 8Z"/>',
    star:     '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8Z"/>',
    sparkle:  '<path d="M11 3.5 12.7 8 17 9.7 12.7 11.4 11 15.8 9.3 11.4 5 9.7 9.3 8Z"/><path d="M17.5 14.5 18.3 16.7 20.5 17.5 18.3 18.3 17.5 20.5 16.7 18.3 14.5 17.5 16.7 16.7Z"/>',
    train:    '<rect x="5" y="3.5" width="14" height="12.5" rx="3"/><path d="M5 11h14"/><circle cx="9" cy="13.5" r=".9"/><circle cx="15" cy="13.5" r=".9"/><path d="m8 20 2-4M16 20l-2-4"/>',
    walk:     '<circle cx="13" cy="4.6" r="1.8"/><path d="m10 20 2.2-5.2-2.2-2 .8-4L14 10l3 1.4"/><path d="m12 12.8-3.2 2.4"/><path d="m15 14 1.5 6"/>',
    wine:     '<path d="M7.5 4h9l-1 5a3.5 3.5 0 0 1-7 0Z"/><path d="M12 12.5V20M8.5 20h7"/>',
    cart:     '<circle cx="10" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M3 4h2.2l2.3 10.4h10.2l1.8-7.4H6"/>',
    dumbbell: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
    briefcase:'<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3.5 12.5h17"/>',
    tree:     '<path d="M12 3.5 7 11h3l-3.5 5h11L14 11h3Z"/><path d="M12 16v4.5"/>',
    coffee:   '<path d="M4.5 7.5h12v5a5 5 0 0 1-10 0Z"/><path d="M16.5 9h1.8a2.2 2.2 0 0 1 0 4.4h-1.8"/><path d="M4 20.5h13"/>',
    dog:      '<path d="M5 9.5 4 5l3.2 1.8h9.6L20 5l-1 4.5"/><path d="M5 9.5v6a4.5 4.5 0 0 0 4.5 4.5h5A4.5 4.5 0 0 0 19 15.5v-6"/><circle cx="9.5" cy="13" r=".9"/><circle cx="14.5" cy="13" r=".9"/><path d="M12 15.5v1.2"/>',
    snowflake:'<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>',
    window:   '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M12 3.5v17M4 12h16"/>',
    clock:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.2 2"/>',
    building: '<path d="M4 20.5V6.5L12 3l8 3.5v14"/><path d="M9 20.5v-5h6v5"/><path d="M8.5 9.5h2M13.5 9.5h2M8.5 12.5h2M13.5 12.5h2"/>',

    // districts — plain geography, not mascots
    downtown: '<path d="M3.5 20.5V9l5-2.5V20.5"/><path d="M8.5 20.5V4l6 2.5v14"/><path d="M14.5 20.5v-9l6 2.5v6.5"/>',
    north:    '<path d="M3 17.5h18"/><path d="M12 3.5 8 12h8Z"/><path d="M5 20.5h14"/>',
    heights:  '<path d="M3 19h18"/><path d="M6 19V9l6-5 6 5v10"/><path d="M10 19v-4h4v4"/>',
    hills:    '<path d="M2.5 18.5 8 9l4 6 3-4.5 6.5 9Z"/>',
    avenues:  '<path d="M3 21c2.5-2 4.5-2 7 0s4.5 2 7 0"/><path d="M3 16c2.5-2 4.5-2 7 0s4.5 2 7 0"/><path d="M12 3.5v8"/><path d="M8.5 7 12 3.5 15.5 7"/>',
    park:     '<path d="M12 3.5 6.5 12h4l-4 5.5h11L13.5 12h4Z"/><path d="M12 17.5v3.5"/><path d="M3.5 21h17"/>',
    pin:      '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/>',
    grid:     '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    // Matches the ♥ on the save button. Drawn rather than borrowed from `star`
    // so the filter and the control that fills it read as the same gesture.
    heart:    '<path d="M12 20s-7-4.7-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.3 12 20 12 20Z"/>',
  };

  /* Returns markup, not a node, because every caller here builds HTML strings.
     `cls` lets a chip tint it without a second stylesheet rule. */
  function svg(name, size, cls) {
    const d = P[name] || P.pin;
    return `<svg class="ic ${cls || ""}" width="${size || 16}" height="${size || 16}"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  return { svg, has: (n) => !!P[n] };
})();
