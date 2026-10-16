// Sentinel enclosure: the ESP32 on its cradle, the Probes and the Alarm's speaker. Three WAGO 221 lever connectors
// join the supply wires (GND, 3V3, 5V); every signal goes straight to its pin by a Dupont cable.
// The DHT22 and the MQ-2 each have a ventilated compartment of their own, in the two front corners:
// the MQ-2's heater would otherwise warm the DHT22, and the predictive model would learn it as drift.
//
// part = "base" | "lid" (each laid as it prints) | "assembly" | "inside"
// Interior coordinates: X from the left wall's inner face, Y from the front, Z from the floor.

include <common.scad>

part = "assembly";

wall = 2.4;
floor_t = 2.4;
lid_t = 3;
r_out = 5;
iw = 2;  // inner walls

W = 133;
D = 132;
H = 56;

dht_box = [32, 30];   // DHT22 compartment, front left: X 0..32, Y 0..30
mq_box = [31, 36];    // MQ-2 compartment, front right: the module lies flat in it, its can up under the lid
esp = [28.6, 56.6];   // ESP32 DevKitC V4 (AZ-Delivery, 56 x 28 mm), with play
esp_z = 26;           // its board's underside: the Dupont plugs on its pins hang under it
usb_x = W / 2 + 3;    // its USB toward the back, under the cable's notch; clear of the sound module's plugs
esp_at = [usb_x - esp[0] / 2, D - 30 - esp[1]];  // 30 mm left behind it for the USB plug

// WAGO 221 lever connectors: 18.6 deep, 8.3 high, their width by the number of poles (221-413, 221-415).
function wago_w(n) = n == 3 ? 18.7 : 29.9;
// The team's three, each beside the ESP32's pins it takes: [name engraved beside it, poles, wall (0 left, 1 right), Y].
// GND faces the GND pins of the left header; 3V3 and 5V face the two ends of the right header.
wagos = [["GND", 5, 0, 40], ["3V3", 3, 1, 46], ["5V", 3, 1, 84]];

dht_x = 18;           // DHT22 holder, against the front wall
dht_body = [15.1, 7.7, 25];
dht_z = 22;           // the DHT22 sits this high: its four Dupont plugs go under it
mic = [46, 32];       // CZN-15E capsule on the front wall: X, Z
// The sound module: a 32 x 17 board, flat, its capsule lying on it at the front end, its three pins bent at the back end.
// It runs straight back from the front wall, its board resting on a post: about 56 mm long with its Dupont plugs.
czn_pcb = [17, 32];
czn_mic = [9.7, 6.5];
czn_z = mic[1] - czn_mic[0] / 2 - 1.6;  // its board's underside
pir = [80, 32];       // HC-SR501 dome on the front wall: X, Z
pir_skirt = 4;        // from the wall to the PIR's board: the lens' square foot
// The Flying Fish MQ-2 module: a 32 x 20 board, the can 12.5 mm from its front end, its four pins bent under its back end.
// It lies flat on four posts, screwed through its corner holes, its can up under the lid's slots: its heat goes
// straight out the top, the air comes in low through the front and side slots. Its Dupont plugs point to the back,
// out of the compartment through a slot in its wall.
mq_pcb = [32, 20];
mq_can = [19.8, 17];  // diameter, height over the board
mq_can_at = 12.5;
mq_holes = [15, 27];  // its four corner holes, across and along: M2.5 screws into the posts
mq_at = [W - 20, 2];                           // the board's centre line, its front end: clear of the lid's corner screw
mq_z = H - 3 - mq_can[1] - 1.6;                // the board's underside: the can stops 3 mm under the lid
mq_can_c = [mq_at[0], mq_at[1] + mq_can_at];   // the can's axis
spk = [30.6, 70.6, 18];          // the speaker, 30 x 70 x 18, under the lid along the right wall, its face up
spk_at = [W - clr - 1.6 - spk[0] / 2, (mq_box[1] + D) / 2 - 3];  // its centre: the frame's right side is the lid's lip

corner = [[4.5, 4.5], [W - 4.5, 4.5], [4.5, D - 4.5], [W - 4.5, D - 4.5]];
feet = [[16, 16], [W - 16, 16], [16, D - 16], [W - 16, D - 16]];

module front_cut(x, z, depth) translate([x, 1, z]) rotate([90, 0, 0]) linear_extrude(depth) children();
module back_cut(x, z, depth) translate([x, D - 1, z]) rotate([90, 0, 180]) linear_extrude(depth) children();
module left_cut(y, z, depth) translate([1, y, z]) rotate([90, 0, -90]) linear_extrude(depth) children();
module right_cut(y, z, depth) translate([W - 1, y, z]) rotate([90, 0, 90]) linear_extrude(depth) children();

module inner_walls_2d() {
  translate([dht_box[0], 0]) square([iw, dht_box[1] + iw]);
  translate([0, dht_box[1]]) square([dht_box[0] + iw, iw]);
  translate([W - mq_box[0] - iw, 0]) square([iw, mq_box[1] + iw]);
  translate([W - mq_box[0] - iw, mq_box[1]]) square([mq_box[0] + iw, iw]);
}

// The DHT22 drops in from above, its grille against the vents, and rests on two pillars.
module dht_holder() {
  b = [dht_body[0] + 0.5, dht_body[1] + 0.5];
  t = 1.6;
  top = dht_z + dht_body[2] - 4;
  translate([dht_x, 0, 0]) {
    for (s = [-1, 1]) {
      translate([s * (b[0] / 2 + t / 2) - t / 2, 0, 0]) cube([t, b[1] + t, top]);
      translate([s * (b[0] / 2 - 1.5) - 1.5, b[1], dht_z]) cube([3, t, top - dht_z]);
      translate([s * (b[0] / 2 - 1.15) - 1.15, 0, 0]) cube([2.3, b[1], dht_z]);
    }
  }
}

// The ESP32 stands on two cradles at its ends, pins down: the Dupont plugs go on its pins before it drops in,
// and the side guides' lips hold it. The front cradle stays under the board, for the module that may overhang it.
module esp_cradles() for (end = [0, 1]) translate([usb_x, esp_at[1] + end * esp[1], 0]) mirror([0, end, 0]) {
  // a pillar and its ledge, between the two rows of pins
  translate([-8, -2, 0]) cube([16, 8, esp_z]);
  // the end wall, cut for the module at the front and for the USB plug at the back
  difference() {
    translate([-esp[0] / 2 - 1.6, -2, 0]) cube([esp[0] + 3.2, 2, esp_z + 3]);
    translate([end ? -7 : -10, -3, esp_z]) cube([end ? 14 : 20, 4, 10]);
  }
  for (sx = [-1, 1]) scale([sx, 1, 1]) {
    // a guide along the board's edge, its foot sloping into the wall to print
    hull() {
      translate([esp[0] / 2, -eps, esp_z - 3]) cube([1.6, 4, 6]);
      translate([esp[0] / 2, -eps, esp_z - 7]) cube([1.6, eps, 1]);
    }
    // its lip, 0.4 mm over the board
    translate([esp[0] / 2, 0, esp_z + 1.7]) rotate([-90, 0, 0]) linear_extrude(4) polygon([[0, 0], [-0.4, -0.3], [0, -1.2]]);
  }
}

// Against its wall: x = 0 on the left wall, mirrored onto the right one.
module at_wall(side) if (side == 0) children(); else translate([W, 0, 0]) mirror([1, 0, 0]) children();

// A WAGO 221 lies in each pocket, levers up, its wire openings toward the middle; ribs hold it by its sides.
module wago_pockets() for (g = wagos) at_wall(g[2]) translate([0, g[3], 0]) {
  w = wago_w(g[1]) + 0.4;
  for (y = [-1.6, w]) translate([0, y, 0]) cube([16, 1.6, 4]);
  for (y = [0, w]) translate([8, y, 0]) cylinder(h = 4, d = 1, $fn = 16);
  translate([18.6 + 0.4, -1.6, 0]) cube([1.6, w + 3.2, 1.5]);  // a stop, under its wire openings
}

module wago_labels() for (g = wagos)
  translate([g[2] ? W - 30 : 30, g[3] + (wago_w(g[1]) + 0.4) / 2, 0]) label(g[0], 3.5);

// ---------------------------------------------------------------- base: floor and walls, printed floor down

module base() {
  difference() {
    union() {
      difference() {
        translate([-wall, -wall, -floor_t]) rbox([W + 2 * wall, D + 2 * wall, floor_t + H], r_out, ch_bot = 0.8);
        cube([W, D, H + 1]);
      }
      linear_extrude(H) inner_walls_2d();
      for (c = corner) translate(c) cylinder(h = H, d = 9);
      esp_cradles();
      wago_pockets();
      dht_holder();
      translate([mic[0], 0, mic[1]]) rotate([-90, 0, 0]) cradle(10.3, 13.5, 2.5);
      // the post its board rests on, under its mounting hole: hot glue, or an M3 if the hole falls on it
      translate([mic[0], 29, 0]) boss(czn_z - 0.3, 6, pilot_m3, 8);
      for (s = [-1, 1]) translate([pir[0] + s * 14, 0, pir[1]]) rotate([-90, 0, 0]) boss(pir_skirt, 3.8, pilot_m2, pir_skirt);
      for (sx = [-1, 1], sy = [-1, 1]) translate([mq_at[0] + sx * mq_holes[0] / 2, mq_at[1] + mq_pcb[0] / 2 + sy * mq_holes[1] / 2, 0])
        boss(mq_z, 6, pilot_m25, 8);
    }
    for (c = corner) translate([c[0], c[1], H - 14]) cylinder(h = 15, d = pilot_m3, $fn = 24);
    // the PIR's pilot holes go on into the front wall: an M2 x 6 reaches 4.8 mm past its board, the posts are 4 long
    for (s = [-1, 1]) translate([pir[0] + s * 14, eps, pir[1]]) rotate([90, 0, 0]) cylinder(h = 1.4, d = pilot_m2, $fn = 24);

    // wires out of the two compartments: the DHT22's along the floor, the MQ-2's plugs through a slot open at the top
    translate([12, dht_box[1] - 1, -eps]) cube([10, iw + 2, 12]);
    translate([mq_at[0] - 6, mq_box[1] - 1, mq_z - 6]) cube([12, iw + 2, H]);

    // DHT22: vents in front of its grille and on the side
    front_cut(dht_x, 34, wall + 2) slot_row(4, 20, 2.6, 4.6);
    left_cut(20, 34, wall + 2) slot_row(3, 20, 2.6, 4.6);
    // CZN-15E
    front_cut(mic[0], mic[1], wall + 2) hole_disc(8, 1.6, 2.8);
    // HC-SR501: its dome comes out through the wall
    front_cut(pir[0], pir[1], wall + 2) circle(d = 23.6);
    // MQ-2: holes in front of its can, and vents in the compartment's front
    right_cut(mq_box[1] / 2, 18, wall + 2) slot_row(3, 20, 2.6, 5);
    front_cut(mq_at[0], 20, wall + 2) slot_row(4, 24, 2.6, 5);

    // the USB cable from the Command Post, laid in from above
    back_cut(usb_x, 0, wall + 2) hull() {
      translate([-3.5, H - 6.5]) square([7, 10]);
      translate([0, H - 7]) circle(d = 7);
    }
    for (f = feet) translate([f[0], f[1], -floor_t - eps]) cylinder(h = 1, d = 10.5);
    // each connector's node, engraved in the floor beside it
    wago_labels();
  }
}

// ---------------------------------------------------------------- lid: printed top down

module lid() {
  difference() {
    union() {
      translate([-wall, -wall, H]) rbox([W + 2 * wall, D + 2 * wall, lid_t], r_out, ch_top = 1.2);
      // lip inside the walls, broken where the corners, the inner walls and the cable are
      translate([0, 0, H - 4]) difference() {
        linear_extrude(4 + eps) difference() {
          offset(delta = -clr) square([W, D]);
          offset(delta = -clr - 1.6) square([W, D]);
        }
        for (c = corner) translate([c[0], c[1], -1]) cylinder(h = 6, d = 10.5);
        translate([0, 0, -1]) linear_extrude(6) offset(delta = clr) inner_walls_2d();
        translate([usb_x - 5, D - 3, -1]) cube([10, 4, 6]);
      }
      // the speaker's frame: it goes in face up, a bead of hot glue holds it
      translate([spk_at[0], spk_at[1], H - 8]) linear_extrude(8 + eps) difference() {
        crect([spk[0] + 3.2, spk[1] + 3.2], 2.4);
        crect([spk[0], spk[1]], 1);
      }
    }
    for (c = corner) translate([c[0], c[1], H + lid_t]) cs_m3(lid_t + 2);
    translate([spk_at[0], spk_at[1], H - 1]) linear_extrude(lid_t + 2) slot_row(5, spk[1] - 14, 2.4, 4.8);
    // the DHT22's and the MQ-2's compartments breathe through the lid too
    translate([dht_x, 19, H - 1]) linear_extrude(lid_t + 2) rotate(90) slot_row(3, 16, 2.6, 5);
    translate([mq_can_c[0], mq_can_c[1], H - 1]) linear_extrude(lid_t + 2) slot_row(4, 22, 2.6, 5);
    translate([67, 13, H + lid_t]) label("SENTINEL-X", 7.5);
    // the laser-engraved plate (70 x 40) goes in this recess
    translate([42 - 35, D - 58, H + lid_t - 1]) cube([70, 40, 2]);
  }
}

// ---------------------------------------------------------------- what goes inside, to check the fit (not printed)

module ghosts(speaker = true) {
  // the ESP32: its board, its module, its USB-C plug; the two rows of Dupont plugs under it
  translate([usb_x - 14, esp_at[1] + 0.3, esp_z]) {
    color([0.1, 0.1, 0.12]) cube([28, 56, 1.6]);
    color("Silver") translate([5, 0, 1.6]) cube([18, 25.5, 3.2]);
    color("Silver") translate([10, 56 - 1, 1.6]) cube([8, 22, 3.2]);
    for (x = [1.3 - 1.27, 26.7 - 1.27]) color("Black") translate([x, 3.8, -16.5]) cube([2.54, 48.3, 16.5]);
  }
  // the WAGO connectors in their pockets
  color("Orange", 0.8) for (g = wagos) at_wall(g[2]) translate([0.2, g[3] + 0.2, 0]) cube([18.6, wago_w(g[1]), 8.3]);
  color("White") translate([dht_x - dht_body[0] / 2, 0.2, dht_z]) cube(dht_body);
  color("White") translate([pir[0], -wall, pir[1]]) rotate([-90, 0, 0]) translate([0, 0, -7]) sphere(d = 23);
  color("SeaGreen") translate([pir[0] - 16, pir_skirt, pir[1] - 12]) cube([32, 1.6, 24]);
  // the MQ-2 module: its can, its board, the trimmer under it, its bent pins' header and their four Dupont plugs
  color("Silver") translate([mq_can_c[0], mq_can_c[1], mq_z + 1.6]) cylinder(h = mq_can[1], d = mq_can[0]);
  translate([mq_at[0] - mq_pcb[1] / 2, mq_at[1], mq_z]) {
    color("RoyalBlue") cube([mq_pcb[1], mq_pcb[0], 1.6]);
    color("DodgerBlue") translate([13, 19, -5]) cube([7, 7, 5]);
    color("Black") translate([mq_pcb[1] / 2 - 5.1, mq_pcb[0] - 2.5, -2.5]) cube([10.2, 2.5, 2.5]);
    color("Black") translate([mq_pcb[1] / 2 - 5.1, mq_pcb[0] + 0.5, -2.54]) cube([10.2, 14, 2.54]);
  }
  // the sound module: its capsule, its board, its bent pins' header and their three Dupont plugs
  color("Silver") translate([mic[0], 0.2, mic[1]]) rotate([-90, 0, 0]) cylinder(h = czn_mic[1], d = czn_mic[0]);
  translate([mic[0] - czn_pcb[0] / 2, 3, czn_z]) {
    color("RoyalBlue") cube([czn_pcb[0], czn_pcb[1], 1.6]);
    color("Black") translate([czn_pcb[0] / 2 - 3.8, czn_pcb[1] - 2.5, 1.6]) cube([7.6, 2.5, 2.5]);
    color("Black") translate([czn_pcb[0] / 2 - 3.8, czn_pcb[1] + 0.5, 1.6]) cube([7.6, 14, 2.54]);
  }
  if (speaker) color("DimGray") translate([spk_at[0] - spk[0] / 2 + 0.3, spk_at[1] - spk[1] / 2 + 0.3, H - spk[2]]) cube(spk - [0.6, 0.6, 0]);
}

module assembly() {
  color("SlateGray") base();
  color("SlateGray", 0.45) lid();
  ghosts();
}

if (part == "base") translate([0, 0, floor_t]) base();
else if (part == "lid") translate([0, 0, H + lid_t]) rotate([180, 0, 0]) lid();
else if (part == "assembly") assembly();
else if (part == "inside") { color("SlateGray") base(); ghosts(speaker = false); }
