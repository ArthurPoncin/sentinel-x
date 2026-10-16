// A test of the screw holes, to print before the big parts: posts like the Pi's, their pilot holes from a little
// tighter to a little looser than those drawn in common.scad, each size engraved before it. A real M2.5 and M3 screw
// in each: the right hole takes the screw by hand with a screwdriver, and holds it.
//
// part = "plate" (laid as it prints) | "assembly"

include <common.scad>

part = "plate";

rows = [["M2,5", pilot_m25], ["M3", pilot_m3]];
steps = [-0.2, -0.1, 0, 0.1];
pitch = 12;
row_d = 17;
plate = [18 + len(steps) * pitch, len(rows) * row_d + 2, 2];

module plate() {
  difference() {
    rbox(plate, 2);
    for (r = [0 : len(rows) - 1]) {
      translate([9, r * row_d + 10, plate[2]]) label(rows[r][0], 3.4);
      for (i = [0 : len(steps) - 1]) translate([18 + (i + 0.5) * pitch, r * row_d + 4, plate[2]])
        label(str(rows[r][1] + steps[i]), 2.8);
    }
  }
  // posts 10 mm high: a 12 mm screw still bites before it bottoms out
  for (r = [0 : len(rows) - 1], i = [0 : len(steps) - 1]) translate([18 + (i + 0.5) * pitch, r * row_d + 12, plate[2]])
    boss(10, 6, rows[r][1] + steps[i], 9);
}

if (part == "plate" || part == "assembly") plate();
