// Command Post enclosure: the Raspberry Pi 4, its HDMI status screen in the front,
// and the Logitech C920 webcam on top of a short tower whose 28BYJ-48 stepper turns it.
// The camera's support, on the motor's shaft, is the team's own, already printed (support_c920_28byj48.stl).
//
// part = "shell" | "base" | "bezel" | "tower" (each laid as it prints) | "assembly" | "inside"
// Interior coordinates: X from the left wall's inner face, Y from the front, Z from the base plate's top.

include <common.scad>

part = "assembly";

/* [Screen: 5" HDMI 800x480, the Waveshare 5inch HDMI LCD Rev2.1 board (SunFounder's, Joy-IT's), after Waveshare's 3D model; seen from the front, its HDMI socket on top] */
scr = [121.1, 78];         // circuit board, width x height
scr_holes = [115.1, 83.9]; // its four holes, on rounded ears past the top and bottom edges: M2.5 screws into the bezel's posts
scr_ear = 4.2;             // from a hole's centre to the rounded end of its ear
scr_view = [110.7, 67.4];  // visible area, cut out of the bezel
scr_view_off = [0, 2.2];   // centre of the visible area from the board's centre: right, up
scr_glass = 6.2;           // from the glass's face to the board's: the posts' length
scr_hdmi = [-7.4, 15.1];   // the HDMI socket, on the board's back along its top edge: centre from the board's centre, width
hdmi_room = 20;            // above the board, for a right-angle HDMI adapter whose cable leaves toward the back

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

// The board's centre's height: its lower ears end 1 mm over the base plate, the HDMI adapter goes under the roof.
scr_z = scr_holes[1] / 2 + scr_ear + 1;
W = max(143, scr[0] + 24);                     // interior width
H = max(88, scr_z + scr[1] / 2 + hdmi_room); // interior height, base plate to roof
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

/* [Tower: the camera's support turns on top of it] */
tower_h = 30;              // above the roof
tower_d = [66, 58];        // at its foot, at its top
tower_top = 2.4;           // the motor's face presses under it
tower_at = [W / 2, 40];
tower_screws = [45, 180, 290];   // three screws up through the roof, set so that the tower goes on one way only
r_screw = tower_d[0] / 2 - wall - 2.5;
z_tower = H + roof - 0.6;  // its foot, in a seat 0.6 mm deep in the roof
cam_way = 135;             // the webcam's cable goes into the tower there, just under the support
sup_z = tower_h + 1;       // the support's foot, from the tower's: the shaft goes 6 mm into it
// The motor in the tower's own coordinates: its shaft on the axis, its body behind it.
motor_c = [0, 8];
motor_tabs = [[-17.5, 8], [17.5, 8]];

uln = [28, D - 22];        // ULN2003 board centre
vent = pi_at([26, 30]);    // roof vent, over the Pi's processor and clear of the tower's foot
uln_holes = [29.5, 27];
// The EPSI key fob (70 x 27, its base 2 mm thick) glues on the right wall, into a pocket of its own outline.
badge_stl = "Rajout/Porte_clés_EPSI_monochrome_v3.stl";
badge_at = [76, 56];       // its centre on the right wall: Y, Z (the laser plate's, on the other side)
corner = [[5, 24], [W - 5, 24], [5, D - 5], [W - 5, D - 5]];  // the base's screws, into the shell
feet = [[14, 12], [W - 14, 12], [14, D - 14], [W - 14, D - 14]];

module front_cut(x, z, depth) translate([x, 1, z]) rotate([90, 0, 0]) linear_extrude(depth) children();
module back_cut(x, z, depth) translate([x, D - 1, z]) rotate([90, 0, 180]) linear_extrude(depth) children();
module left_cut(y, z, depth) translate([1, y, z]) rotate([90, 0, -90]) linear_extrude(depth) children();
module right_cut(y, z, depth) translate([W - 1, y, z]) rotate([90, 0, 90]) linear_extrude(depth) children();

// The key fob's outline, centred, with play: the hull of its own STL seen from above.
module badge_2d() offset(delta = clr) translate([-35, -13.5]) hull() projection() import(badge_stl);

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
    }
    for (c = corner) translate([c[0], c[1], -eps]) cylinder(h = 12, d = 2.5, $fn = 24);

    // the tower: its seat, the way down for the motor's and the webcam's cables, its three screws from inside
    translate([tower_at[0], tower_at[1], z_tower]) cylinder(h = 1, d = tower_d[0] + 0.6);
    translate([tower_at[0], tower_at[1], H - 1]) cylinder(h = roof + 2, d = 44);
    for (a = tower_screws) translate([tower_at[0], tower_at[1], H - 1]) rotate(a) translate([r_screw, 0, 0])
      cylinder(h = roof + 2, d = 3.4, $fn = 24);

    // the warm air out, over the Pi's processor: it comes in under the Pi, through the base
    translate([vent[0], vent[1], H - 1]) linear_extrude(roof + 2) intersection() {
      circle(d = 27);
      for (i = [-3 : 3]) translate([i * 4, 0]) square([2.2, 30], center = true);
    }

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
    // right wall: the EPSI key fob's pocket, 1 mm deep, read from outside
    translate([W + wall - 1, badge_at[0], badge_at[1]]) rotate([90, 0, 90]) linear_extrude(2) badge_2d();
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
      // the bezel's bottom edge stands between these two; the rib behind it lets the screen's lower posts through
      difference() {
        for (y = [[0, lip_d], [y_rib, y_rib + rib_d]]) translate([lip_in + clr, y[0], 0]) cube([W - 2 * (lip_in + clr), y[1] - y[0], lip_in]);
        for (sx = [-1, 1]) translate([W / 2 + sx * scr_holes[0] / 2 - 4, y_rib - 1, -1]) cube([8, rib_d + 2, lip_in + 2]);
      }
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

module bezel() {
  y0 = y_slot + 0.2;
  difference() {
    union() {
      translate([clr, y0, 0]) cube([W - 2 * clr, bz_t, H - clr]);
      // a post under each of the board's ears; the glass presses on the bezel when their screws are tight
      for (sx = [-1, 1], sz = [-1, 1]) translate([W / 2 + sx * scr_holes[0] / 2, y0 + bz_t, scr_z + sz * scr_holes[1] / 2])
        rotate([-90, 0, 0]) boss(scr_glass - 0.2, 6, 2.1, scr_glass - 0.2);
    }
    // window, chamfered toward the front
    translate([W / 2 + scr_view_off[0], y0 - eps, scr_z + scr_view_off[1]]) rotate([-90, 0, 0]) hull() {
      translate([0, 0, 1.2]) linear_extrude(bz_t) crect(scr_view, 1);
      linear_extrude(eps) crect(scr_view + [2.4, 2.4], 2.2);
    }
  }
}

// ---------------------------------------------------------------- tower: on the roof, the motor inside its top

function tower_r(z) = tower_d[0] / 2 + (tower_d[1] - tower_d[0]) / 2 * z / tower_h;  // outer radius at height z

module tower() {
  zt = tower_h - tower_top;
  difference() {
    union() {
      difference() {
        hull() {
          cylinder(h = eps, d = tower_d[0]);
          translate([0, 0, tower_h - 1.2]) cylinder(h = eps, r = tower_r(tower_h - 1.2));
          translate([0, 0, tower_h - eps]) cylinder(h = eps, r = tower_r(tower_h) - 1.2);
        }
        translate([0, 0, -eps]) cylinder(h = zt + eps, r1 = tower_d[0] / 2 - wall, r2 = tower_r(zt) - wall);
      }
      // the screws' bosses, along the wall at the foot; their tops slope into the wall, to print upside down
      for (a = tower_screws) rotate(a) translate([r_screw, 0, 0]) hull() {
        cylinder(h = 12, d = 6);
        translate([1.5, 0, 19]) cylinder(h = eps, d = 1);
      }
    }
    for (a = tower_screws) rotate(a) translate([r_screw, 0, -eps]) cylinder(h = 10, d = 2.5, $fn = 24);
    // the motor: its shaft and boss, its two screws countersunk; a hollow round the shaft, under the support's hub
    translate([0, 0, zt - 1]) cylinder(h = tower_top + 2, d = 11);
    translate([0, 0, tower_h - 1.2]) cylinder(h = 2, d = 20);
    for (t = motor_tabs) translate([t[0], t[1], tower_h]) cs_m3(tower_top + 2);
    // the webcam's cable, behind and to the left
    rotate(cam_way) translate([tower_r(zt) - 8, 0, zt - 8]) rotate([0, 90, 0]) linear_extrude(14) rotate(90) stadium(18, 11);
    // a band engraved round its foot, and the zero mark at the front: the camera's lens over it, it looks straight ahead
    translate([0, 0, 7]) difference() {
      cylinder(h = 1.2, r = tower_d[0]);
      cylinder(h = 1.2, r1 = tower_r(7) - 0.6, r2 = tower_r(8.2) - 0.6);
    }
    translate([0, -tower_r(tower_h - 6), tower_h - 6]) rotate([90, 0, 0]) linear_extrude(2, center = true)
      polygon([[-2.4, -2], [2.4, -2], [0, 2.2]]);
  }
}

// ---------------------------------------------------------------- the camera's support: already printed, here to check the fit

// support_c920_28byj48.stl, as measured: a hub on the shaft, a 30 mm plate, the 1/4" stud the C920 screws on.
module cam_support() difference() {
  union() {
    cylinder(h = 9, r1 = 6.1, r2 = 15);
    translate([0, 0, 9]) cylinder(h = 3, d = 30);
    translate([0, 0, 12]) cylinder(h = 5, d = 6.2);
  }
  translate([0, 0, -eps]) linear_extrude(6.5) intersection() {
    circle(d = 5.2);
    square([6, 3.2], center = true);
  }
}

// ---------------------------------------------------------------- what goes inside, to check the fit (not printed)

module ghosts(on_top = true) {
  // Raspberry Pi 4
  color("ForestGreen") translate([x_sd - pi[0], y_pi, pi_so]) cube([pi[0], pi[1], pcb_t]);
  color("Silver") {
    translate([x_sd - pi[0] - 2.5, y_pi + pi[1] - 45.75 - 8, pi_so + pcb_t]) cube([21, 16, 13.5]);
    for (y = [9, 27]) translate([x_sd - pi[0] - 2.5, y_pi + pi[1] - y - 7.5, pi_so + pcb_t]) cube([17, 15, 16]);
  }
  color("Black") translate([x_sd - 57.9, y_pi + 1.5, pi_so + pcb_t]) cube([50.8, 5, 8.5]);
  // the screen: the touch glass, the panel, the board with its rounded ears, the GPIO header and the HDMI socket on its back
  translate([W / 2, y_slot + 0.2 + bz_t, scr_z]) {
    color([0.3, 0.32, 0.35]) translate([-0.2 - 58.85, 0, 0.4 - 37]) cube([117.7, 1.1, 74]);
    color([0.05, 0.05, 0.08]) translate([-60.35, 1.1, -37.9]) cube([120.7, 3.1, 75.8]);
    color("DarkGreen") translate([-scr[0] / 2, scr_glass, -scr[1] / 2]) cube([scr[0], 1.6, scr[1]]);
    color("DarkGreen") for (sx = [-1, 1], sz = [-1, 1]) translate([sx * scr_holes[0] / 2, scr_glass + 1.6, sz * scr_holes[1] / 2])
      rotate([90, 0, 0]) linear_extrude(1.6) mirror([0, sz < 0 ? 1 : 0]) difference() {
        hull() {
          translate([-3, -(scr_holes[1] - scr[1]) / 2]) square([6, eps]);
          translate([0, scr_ear - 3]) circle(r = 3);
        }
        circle(d = 3);
      }
    color("Black") translate([-15.6, scr_glass + 1.6, -16.25]) cube([33, 13.5, 5]);
    color("Silver") translate([scr_hdmi[0] - scr_hdmi[1] / 2, scr_glass + 1.6, scr[1] / 2 - 11.5]) cube([scr_hdmi[1], 6.2, 12.1]);
    // a right-angle HDMI adapter, then the cable's plug toward the back
    color([0.2, 0.2, 0.22]) translate([scr_hdmi[0] - 11, scr_glass - 1.5, scr[1] / 2 + 0.6]) cube([22, 13, 15]);
    color([0.2, 0.2, 0.22]) translate([scr_hdmi[0] - 10.5, scr_glass + 11.5, scr[1] / 2 + 2]) cube([21, 30, 11]);
  }
  // ULN2003
  color("Teal") translate([uln[0] - 17.5, uln[1] - 16, 5]) cube([35, 32, 1.6]);
  if (on_top) {
    // 28BYJ-48 under the tower's top
    translate([tower_at[0], tower_at[1], z_tower + tower_h - tower_top]) {
      color("Gold") translate([motor_c[0], motor_c[1], -19]) cylinder(h = 19, d = 28);
      color("Gold") cylinder(h = 9.5, d = 5);
    }
    // the camera's support, and the Logitech C920 on it: its clip folded under it, its body 94 x 24 x 29, the lens toward the front
    color("Orange") translate([tower_at[0], tower_at[1], z_tower + sup_z]) cam_support();
    translate([tower_at[0], tower_at[1], z_tower + sup_z + 12]) color([0.12, 0.12, 0.13]) {
      translate([-15, -14, 0]) cube([30, 28, 14]);
      translate([0, -2, 14 + 14.5]) scale([94, 24, 29] / 29) rotate([0, 90, 0]) cylinder(h = 29, d = 29, center = true);
    }
  }
}

module assembly() {
  color("SlateGray", 0.55) shell();
  color("DarkSlateGray") base();
  color([0.12, 0.13, 0.15]) bezel();
  color("SlateGray") translate([tower_at[0], tower_at[1], z_tower]) tower();
  ghosts();
  // the EPSI key fob, glued in its pocket
  color("RoyalBlue") translate([W + wall - 1, badge_at[0], badge_at[1]]) rotate([90, 0, 90]) translate([-35, -13.5, 2]) import(badge_stl);
}

// The base, the bezel and what goes inside, the shell cut low to show them.
module inside() {
  color("SlateGray") intersection() {
    shell();
    translate([-10, -10, -base_t - 1]) cube([W + 20, D + 20, 30]);
  }
  color("DarkSlateGray") base();
  color([0.12, 0.13, 0.15]) bezel();
  ghosts(on_top = false);
}

if (part == "shell") translate([0, 0, H + roof]) rotate([180, 0, 0]) shell();
else if (part == "base") translate([0, 0, base_t]) base();
else if (part == "bezel") translate([0, 0, -(y_slot + 0.2)]) rotate([90, 0, 0]) bezel();
else if (part == "tower") translate([0, 0, tower_h]) rotate([180, 0, 0]) tower();
else if (part == "assembly") assembly();
else if (part == "inside") inside();
