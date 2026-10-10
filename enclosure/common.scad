// Helpers shared by the Sentinel-X enclosures. Units: mm.

$fn = 72;
eps = 0.01;
clr = 0.3;  // play between two printed parts that fit together

// Rounded rectangle, its corner at the origin.
module rrect(size, r) {
  rr = max(min(r, min(size[0], size[1]) / 2 - eps), eps);
  translate([rr, rr]) offset(r = rr) square([size[0] - 2 * rr, size[1] - 2 * rr]);
}

// Rounded rectangle centred on the origin.
module crect(size, r) translate(-size / 2) rrect(size, r);

// Block with rounded vertical edges, its corner at the origin. ch_top and ch_bot chamfer the top and bottom edges.
module rbox(size, r, ch_top = 0, ch_bot = 0) {
  hull() {
    translate([ch_bot, ch_bot, 0]) linear_extrude(eps) rrect([size[0] - 2 * ch_bot, size[1] - 2 * ch_bot], r - ch_bot);
    translate([0, 0, ch_bot]) linear_extrude(size[2] - ch_bot - ch_top) rrect([size[0], size[1]], r);
    translate([ch_top, ch_top, size[2] - eps]) linear_extrude(eps) rrect([size[0] - 2 * ch_top, size[1] - 2 * ch_top], r - ch_top);
  }
}

// Slot with round ends, l long along X and w wide, centred.
module stadium(l, w) hull() for (s = [-1, 1]) translate([s * (l - w) / 2, 0]) circle(d = w);

// n slots side by side, each l long (along Y) and w wide, p apart along X, centred.
module slot_row(n, l, w, p) for (i = [0 : n - 1]) translate([(i - (n - 1) / 2) * p, 0]) rotate(90) stadium(l, w);

// Round holes of diameter d on rings around the centre, filling a disc of diameter span.
module hole_disc(span, d = 2, pitch = 3.6) {
  circle(d = d);
  for (r = [pitch : pitch : (span - d) / 2]) {
    n = floor(2 * PI * r / pitch);
    for (i = [0 : n - 1]) rotate(i * 360 / n) translate([r, 0]) circle(d = d, $fn = 24);
  }
}

// Hole for a countersunk M3 screw: the head flush at z = 0, the shank along -Z.
module cs_m3(len = 20) {
  translate([0, 0, -len]) cylinder(h = len + eps, d = 3.4);
  translate([0, 0, -1.9]) cylinder(h = 1.9 + eps, d1 = 3.4, d2 = 7);
  cylinder(h = 5, d = 7);
}

// Boss from z = 0 to h, with a pilot hole `depth` deep from its top for a self-tapping screw.
module boss(h, d, pilot, depth) difference() {
  cylinder(h = h, d = d);
  translate([0, 0, h - depth]) cylinder(h = depth + eps, d = pilot, $fn = 24);
}

// Half a ring (its lower half once turned into place) that a round part rests in: a capsule, a gas sensor's can.
// Built along +Z, the half kept is y >= 0.
module cradle(id, od, depth) intersection() {
  difference() {
    cylinder(h = depth, d = od);
    translate([0, 0, -eps]) cylinder(h = depth + 1, d = id);
  }
  translate([-od, 0, -eps]) cube([2 * od, od, depth + 1]);
}

// Text to cut into a face: place it `depth` under the surface, it comes out above.
module label(t, size, depth = 0.6, font = "Liberation Sans:style=Bold", spacing = 1.1)
  translate([0, 0, -depth]) linear_extrude(depth + 1)
    text(t, size = size, font = font, halign = "center", valign = "center", spacing = spacing);
