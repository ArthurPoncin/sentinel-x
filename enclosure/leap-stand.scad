// Stand for the original Leap Motion Controller (80 x 30 mm, 11.3 to 13 mm thick), on the Operator's desk.
// The sensor lies flat, its top well above the rim: nothing gets in its 150 degree field of view.
// Its USB cable leaves through either end, whichever way it is laid.

include <common.scad>

part = "stand";  // "stand" (as it prints) | "assembly"

leap = [80, 30];
fit = 0.6;
depth = 7;        // pocket
L = 128;
Wd = 58;
Ht = 15;

module stand() difference() {
  translate([-L / 2, -Wd / 2, 0]) rbox([L, Wd, Ht], 10, ch_top = 4, ch_bot = 0.6);
  translate([0, 0, Ht - depth]) linear_extrude(depth + 1) crect(leap + [fit, fit], 3);
  // the cable, at either end
  for (s = [-1, 1]) translate([s * (leap[0] / 2 + 20), 0, 0]) rotate([90, 0, 90]) linear_extrude(40, center = true) hull() {
    translate([0, Ht - depth + 1.5 + 8.5]) circle(d = 17);
    translate([-8.5, Ht]) square([17, 10]);
  }
  // to lift the sensor out
  translate([0, leap[1] / 2, Ht - depth + 2]) scale([1, 0.55, 1]) cylinder(h = depth, d = 26);
  translate([0, -(leap[1] / 2 + Wd / 2 - 4) / 2 - 0.4, Ht]) label("SENTINEL-X", 4.6);
  for (sx = [-1, 1], sy = [-1, 1]) translate([sx * (L / 2 - 14), sy * (Wd / 2 - 12), -eps]) cylinder(h = 1, d = 10.5);
}

module ghost() color([0.12, 0.12, 0.12]) translate([0, 0, Ht - depth]) linear_extrude(11.3) crect(leap, 5);

if (part == "stand") stand();
else if (part == "assembly") { color("SlateGray") stand(); ghost(); }
