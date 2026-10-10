// Command Post enclosure: the Raspberry Pi 4, its HDMI status screen in the front,
// and the USB webcam on a turntable that the 28BYJ-48 stepper turns, on the roof.
//
// part = "shell" | "base" | "bezel" | "clamps" | "turntable" (each laid as it prints) | "assembly" | "inside"
// Interior coordinates: X from the left wall's inner face, Y from the front, Z from the base plate's top.

include <common.scad>

part = "assembly";

/* [Screen: measure yours] */
scr = [121.2, 78];         // module outline, glass and board, width x height. Default: a 5" HDMI 800x480
scr_view = [108.5, 65.5];  // visible area, cut out of the bezel
scr_view_off = [0, 0];     // centre of the visible area from the module's centre, seen from the front: right, up
scr_edge = 7;              // module thickness along its top and bottom edges, where the clamps press

/* [Shell] */
wall = 2.4;
roof = 2.4;
base_t = 3;
r_out = 4;

/* [Raspberry Pi 4] */
pi = [85, 56];
pi_holes = [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]];
pi_so = 6;     // standoffs
pcb_t = 1.5;
y_pi = 38;     // the Pi's GPIO edge from the front: the screen's room is in front of it

W = max(143, scr[0] + 24);  // interior width
H = max(88, scr[1] + 12);   // interior height, base plate to roof
D = y_pi + pi[1] + 44;      // interior depth: behind the Pi, the plugs of its USB-C and micro-HDMI, and the ULN2003

// The Pi lies turned half a turn: its GPIO toward the screen, its USB and Ethernet toward the left,
// its SD card against the right wall. pi_at() takes a point of the Pi's own drawing to the box.
x_sd = W - 0.8;
function pi_at(p) = [x_sd - p[0], y_pi + pi[1] - p[1]];

/* [Front frame: the bezel slides up between lips and ribs] */
lip_d = 2.5;               // lips, in front of the bezel
lip_in = 4;                // how far lips and ribs reach in
bz_t = 3;                  // bezel thickness
y_slot = lip_d;
y_rib = lip_d + bz_t + 0.4;
rib_d = 2.5;

/* [Turret] */
tt_d = 64;                 // turntable
tt_gap = 1;                // between turntable and roof
shaft = [W / 2, 40];
motor_c = shaft + [0, 8];  // the motor's body sits behind its shaft
motor_tabs = [motor_c - [17.5, 0], motor_c + [17.5, 0]];
cam_slot = [shaft[0], shaft[1] + tt_d / 2 + 12];  // the webcam's cable goes in there

fan = [W - 26, D - 26];    // 30 mm fan, optional
uln = [28, D - 22];        // ULN2003 board centre
uln_holes = [29.5, 27];
corner = [[5, 24], [W - 5, 24], [5, D - 5], [W - 5, D - 5]];  // the base's screws, into the shell
feet = [[14, 12], [W - 14, 12], [14, D - 14], [W - 14, D - 14]];

module front_cut(x, z, depth) translate([x, 1, z]) rotate([90, 0, 0]) linear_extrude(depth) children();
module back_cut(x, z, depth) translate([x, D - 1, z]) rotate([90, 0, 180]) linear_extrude(depth) children();
module left_cut(y, z, depth) translate([1, y, z]) rotate([90, 0, -90]) linear_extrude(depth) children();
module right_cut(y, z, depth) translate([W - 1, y, z]) rotate([90, 0, 90]) linear_extrude(depth) children();

// The shell's outline, seen from above.
module outline_2d() translate([-wall, 0]) rrect([W + 2 * wall, D + wall], r_out);

// ---------------------------------------------------------------- shell: roof and three walls, printed roof down

module shell() {
  difference() {
    union() {
      difference() {
        translate([-wall, 0, -base_t]) rbox([W + 2 * wall, D + wall, base_t + H + roof], r_out, ch_top = 1.2);
        translate([0, -1, -base_t - 1]) cube([W, D + 1, base_t + H + 1]);
      }
      // lips and ribs, on both walls and under the roof
      for (y = [[0, lip_d], [y_rib, y_rib + rib_d]]) {
        for (x = [0, W - lip_in]) translate([x, y[0], 0]) cube([lip_in, y[1] - y[0], H]);
        translate([0, y[0], H - lip_in]) cube([W, y[1] - y[0], lip_in]);
      }
      for (c = corner) translate([c[0], c[1], 0]) cylinder(h = H, d = 8);
      // the fan's frame: it presses against it, the air goes through the grille
      translate([fan[0], fan[1], H - 3]) linear_extrude(3 + eps) difference() {
        crect([33, 33], 3);
        circle(d = 28.5);
      }
    }
    for (c = corner) translate([c[0], c[1], -eps]) cylinder(h = 12, d = 2.5, $fn = 24);

    // turret: the shaft and its boss, the motor's two screws, a ring and a zero mark engraved on the roof
    translate([shaft[0], shaft[1], H - 1]) cylinder(h = roof + 2, d = 11);
    for (t = motor_tabs) translate([t[0], t[1], H + roof]) cs_m3(roof + 2);
    translate([shaft[0], shaft[1], H + roof - 0.6]) linear_extrude(1) difference() {
      circle(d = tt_d + 6);
      circle(d = tt_d + 3.6);
    }
    translate([shaft[0], shaft[1] - tt_d / 2 - 5.5, H + roof - 0.6]) linear_extrude(1)
      polygon([[-2.6, -1.8], [2.6, -1.8], [0, 2.2]]);

    translate([cam_slot[0], cam_slot[1], H - 1]) linear_extrude(roof + 2) stadium(22, 12);

    // fan grille and its four screws
    translate([fan[0], fan[1], H - 1]) linear_extrude(roof + 2) intersection() {
      circle(d = 27);
      for (i = [-3 : 3]) translate([i * 4, 0]) square([2.2, 30], center = true);
    }
    for (sx = [-1, 1], sy = [-1, 1]) translate([fan[0] + 12 * sx, fan[1] + 12 * sy, H - 3 - eps]) cylinder(h = 5, d = 2.5, $fn = 24);

    // air in, low on both sides, behind the Pi
    left_cut(102, 18, wall + 2) slot_row(7, 20, 3, 6);
    right_cut(102, 18, wall + 2) slot_row(7, 20, 3, 6);

    // the SD card, right wall
    translate([W - 1, pi_at([0, 28])[1] - 8, -base_t - 1]) cube([wall + 2, 16, base_t + 1 + pi_so + pcb_t + 2.5]);

    // cables out at the back, laid in from below before the base closes: the ESP32's USB and the Ethernet, then the power
    for (n = [[22, 18], [W - 14, 12]]) back_cut(n[0], 0, wall + 2) hull() {
      translate([-n[1] / 2, -base_t - 1]) square([n[1], 1]);
      translate([0, 8 - n[1] / 2]) circle(d = n[1]);
    }

    translate([W / 2, D + wall, H * 0.6]) rotate([90, 0, 180]) label("SENTINEL-X", 9);
    translate([W / 2, D + wall, H * 0.6 - 11]) rotate([90, 0, 180]) label("POSTE DE COMMANDE", 4.2, spacing = 1.25);

    // left wall: the laser-engraved plate (100 x 40) goes in this recess
    translate([-wall - eps, 26, 36]) cube([1 + eps, 100, 40]);
  }
}

// ---------------------------------------------------------------- base plate, inside the walls

module base() {
  difference() {
    union() {
      translate([0, 0, -base_t]) linear_extrude(base_t) intersection() {
        translate([clr, 0]) square([W - 2 * clr, D - clr]);
        outline_2d();
      }
      // the bezel's bottom edge stands between these two
      for (y = [[0, lip_d], [y_rib, y_rib + rib_d]]) translate([lip_in + clr, y[0], 0]) cube([W - 2 * (lip_in + clr), y[1] - y[0], lip_in]);
      for (h = pi_holes) translate(pi_at(h)) boss(pi_so, 6, 2.3, 5);
      for (sx = [-1, 1], sy = [-1, 1]) translate(uln + [sx * uln_holes[0], sy * uln_holes[1]] / 2) boss(5, 6, 2.5, 5);
    }
    for (c = corner) translate([c[0], c[1], -base_t]) mirror([0, 0, 1]) cs_m3(base_t + 1);
    for (f = feet) translate([f[0], f[1], -base_t - eps]) cylinder(h = 1, d = 10.5);
    // air in, under the Pi
    translate([x_sd - pi[0] / 2, y_pi + pi[1] / 2, -base_t - 1]) linear_extrude(base_t + 2) slot_row(9, 30, 3, 7);
  }
}

// ---------------------------------------------------------------- bezel: the front, with the screen behind it

module_at = [(W - scr[0]) / 2, (H - scr[1]) / 2];  // the module's lower left corner, X and Z
clamp_x = scr[0] / 2 + 4;
clamp_z = scr[1] / 2 - 4;

module bezel() {
  y0 = y_slot + 0.2;
  difference() {
    union() {
      translate([clr, y0, 0]) cube([W - 2 * clr, bz_t, H - clr]);
      for (sx = [-1, 1], sz = [-1, 1]) translate([W / 2 + sx * clamp_x, y0 + bz_t, H / 2 + sz * clamp_z])
        rotate([-90, 0, 0]) boss(scr_edge, 6.5, 2.5, scr_edge);
      // guides on the module's left and right edges
      for (sx = [-1, 1]) translate([W / 2 + sx * (scr[0] / 2 + 1.2), y0 + bz_t + 2, H / 2]) cube([1.6, 4, 16], center = true);
    }
    // window, chamfered toward the front
    translate([W / 2 + scr_view_off[0], y0 - eps, H / 2 + scr_view_off[1]]) rotate([-90, 0, 0]) hull() {
      translate([0, 0, 1.2]) linear_extrude(bz_t) crect(scr_view, 1);
      linear_extrude(eps) crect(scr_view + [2.4, 2.4], 2.2);
    }
  }
}

// The two bars that hold the module against the bezel, along its top and bottom edges.
module clamps() for (i = [0, 1]) translate([0, i * 14, 0]) difference() {
  linear_extrude(3) crect([2 * clamp_x + 8, 8], 2);
  for (sx = [-1, 1]) translate([sx * clamp_x, 0, -1]) cylinder(h = 5, d = 3.4);
}

// ---------------------------------------------------------------- turntable: on the stepper's shaft, the webcam clips on its bar

tt_bar = [48, 12, 24];  // a monitor's top edge, for the webcam's clip

module turntable() difference() {
  union() {
    hull() {
      cylinder(h = 2.2, d = tt_d);
      cylinder(h = 3, d = tt_d - 1.6);
    }
    translate([-tt_bar[0] / 2, -tt_bar[1] / 2, 0]) rbox(tt_bar + [0, 0, 3], 2, ch_top = 1);
  }
  // the 28BYJ-48's shaft: 5 mm, flats 3 mm apart. A screw from the back holds it if the fit is loose
  translate([0, 0, -eps]) linear_extrude(10) intersection() {
    circle(d = 5.25, $fn = 48);
    square([6, 3.15], center = true);
  }
  translate([0, 0, 4.5]) rotate([-90, 0, 0]) cylinder(h = 10, d = 2.5, $fn = 24);
  // a strap through these holds a webcam without a clip
  for (sx = [-1, 1]) translate([sx * 28, 0, -1]) linear_extrude(5) rotate(90) stadium(20, 3.2);
  // the front: points at the zero mark on the roof when the camera looks straight ahead
  translate([0, -tt_d / 2, -1]) linear_extrude(5) polygon([[-2.6, -1], [2.6, -1], [0, 3.2]]);
}

// ---------------------------------------------------------------- what goes inside, to check the fit (not printed)

module ghosts() {
  // Raspberry Pi 4
  color("ForestGreen") translate([x_sd - pi[0], y_pi, pi_so]) cube([pi[0], pi[1], pcb_t]);
  color("Silver") {
    translate([x_sd - pi[0] - 2.5, y_pi + pi[1] - 45.75 - 8, pi_so + pcb_t]) cube([21, 16, 13.5]);
    for (y = [9, 27]) translate([x_sd - pi[0] - 2.5, y_pi + pi[1] - y - 7.5, pi_so + pcb_t]) cube([17, 15, 16]);
  }
  color("Black") translate([x_sd - 57.9, y_pi + 1.5, pi_so + pcb_t]) cube([50.8, 5, 8.5]);
  // screen module behind the bezel
  color("DimGray") translate([module_at[0], y_slot + 0.2 + bz_t, module_at[1]]) cube([scr[0], scr_edge, scr[1]]);
  // 28BYJ-48 under the roof
  color("Gold") translate([motor_c[0], motor_c[1], H - 19]) cylinder(h = 19, d = 28);
  color("Gold") translate([shaft[0], shaft[1], H]) cylinder(h = 10, d = 5);
  // ULN2003
  color("Teal") translate([uln[0] - 17.5, uln[1] - 16, 5]) cube([35, 32, 1.6]);
  // a webcam on the bar
  color([0.15, 0.15, 0.15]) translate([shaft[0] - 40, shaft[1] - 22, H + roof + tt_gap + 3 + tt_bar[2]]) cube([80, 30, 30]);
}

module assembly() {
  color("SlateGray", 0.55) shell();
  color("DarkSlateGray") base();
  color([0.12, 0.13, 0.15]) bezel();
  color("Orange") translate([shaft[0], shaft[1], H + roof + tt_gap]) turntable();
  ghosts();
}

// The base, the bezel and what goes inside, the shell cut low to show them.
module inside() {
  color("SlateGray") intersection() {
    shell();
    translate([-10, -10, -base_t - 1]) cube([W + 20, D + 20, 30]);
  }
  color("DarkSlateGray") base();
  color([0.12, 0.13, 0.15]) bezel();
  ghosts();
}

if (part == "shell") translate([0, 0, H + roof]) rotate([180, 0, 0]) shell();
else if (part == "base") translate([0, 0, base_t]) base();
else if (part == "bezel") translate([0, 0, -(y_slot + 0.2)]) rotate([90, 0, 0]) bezel();
else if (part == "clamps") clamps();
else if (part == "turntable") turntable();
else if (part == "assembly") assembly();
else if (part == "inside") inside();
