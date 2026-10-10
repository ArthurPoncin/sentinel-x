// Sentinel enclosure: the ESP32 on its two half breadboards, the Probes and the Alarm's speaker.
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

W = 146;
D = 150;
H = 56;

dht_box = [32, 30];   // DHT22 compartment, front left: X 0..32, Y 0..30
mq_box = [44, 36];    // MQ-2 compartment, front right: its can, its board and the Dupont plugs behind it
bb = [112, 86];       // two half breadboards (400 points) glued side by side, with play
bb_at = [(W - bb[0]) / 2, 38];

dht_x = 18;           // DHT22 holder, against the front wall
dht_body = [15.1, 7.7, 25];
dht_z = 22;           // the DHT22 sits this high: its four Dupont plugs go under it
mic = [46, 32];       // CZN-15E capsule on the front wall: X, Z
pir = [80, 32];       // HC-SR501 dome on the front wall: X, Z
pir_skirt = 4;        // from the wall to the PIR's board: the lens' square foot
mq = [22, 30];        // MQ-2 can on the right wall: Y, Z
usb_x = W / 2;        // the ESP32 straddles the joint of the two breadboards, its USB toward the back
spk = [W - 32, D - 32];          // speaker, under the lid
spk_steps = [29, 37, 41, 51];    // its seat takes speakers of 28, 36, 40 and 50 mm

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
      // corners of the breadboards
      for (cx = [0, 1], cy = [0, 1]) translate([bb_at[0] + cx * bb[0], bb_at[1] + cy * bb[1], 0])
        scale([cx ? -1 : 1, cy ? -1 : 1, 1]) {
          translate([-2, -2, 0]) cube([14, 2, 5]);
          translate([-2, -2, 0]) cube([2, 14, 5]);
        }
      dht_holder();
      translate([mic[0], 0, mic[1]]) rotate([-90, 0, 0]) cradle(10.3, 13.5, 4);
      for (s = [-1, 1]) translate([pir[0] + s * 14, 0, pir[1]]) rotate([-90, 0, 0]) boss(pir_skirt, 3.8, 1.7, pir_skirt);
      translate([W, mq[0], mq[1]]) rotate([0, -90, 0]) rotate([0, 0, 90]) cradle(20.6, 24, 4);
    }
    for (c = corner) translate([c[0], c[1], H - 14]) cylinder(h = 15, d = 2.5, $fn = 24);

    // wires out of the two compartments, along the floor
    translate([12, dht_box[1] - 1, -eps]) cube([10, iw + 2, 12]);
    translate([W - mq_box[0] + 10, mq_box[1] - 1, -eps]) cube([10, iw + 2, 12]);

    // DHT22: vents in front of its grille and on the side
    front_cut(dht_x, 34, wall + 2) slot_row(4, 20, 2.6, 4.6);
    left_cut(20, 34, wall + 2) slot_row(3, 20, 2.6, 4.6);
    // CZN-15E
    front_cut(mic[0], mic[1], wall + 2) hole_disc(8, 1.6, 2.8);
    // HC-SR501: its dome comes out through the wall
    front_cut(pir[0], pir[1], wall + 2) circle(d = 23.6);
    // MQ-2: holes in front of its can, and vents in the compartment's front
    right_cut(mq[0], mq[1], wall + 2) hole_disc(15, 2.2, 3.8);
    front_cut(W - mq_box[0] / 2, 30, wall + 2) slot_row(4, 26, 2.6, 5);

    // the USB cable from the Command Post, laid in from above
    back_cut(usb_x, 0, wall + 2) hull() {
      translate([-3.5, H - 6.5]) square([7, 10]);
      translate([0, H - 7]) circle(d = 7);
    }
    for (f = feet) translate([f[0], f[1], -floor_t - eps]) cylinder(h = 1, d = 10.5);
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
      // the speaker's seat: it goes in the step of its size, a bead of hot glue holds it
      translate([spk[0], spk[1], H - 8]) difference() {
        cylinder(h = 8 + eps, d = spk_steps[3] + 4);
        for (i = [0 : 3]) translate([0, 0, -eps]) cylinder(h = 8 - 2 * i, d = spk_steps[i]);
      }
    }
    for (c = corner) translate([c[0], c[1], H + lid_t]) cs_m3(lid_t + 2);
    translate([spk[0], spk[1], H - 1]) linear_extrude(lid_t + 2) hole_disc(25, 2, 3.4);
    // the DHT22's and the MQ-2's compartments breathe through the lid too
    translate([dht_x, 19, H - 1]) linear_extrude(lid_t + 2) rotate(90) slot_row(3, 16, 2.6, 5);
    translate([W - mq_box[0] / 2, 21, H - 1]) linear_extrude(lid_t + 2) slot_row(5, 22, 2.6, 5);
    translate([67, 13, H + lid_t]) label("SENTINEL-X", 7.5);
    // the laser-engraved plate (70 x 40) goes in this recess
    translate([42 - 35, 112 - 20, H + lid_t - 1]) cube([70, 40, 2]);
  }
}

// ---------------------------------------------------------------- what goes inside, to check the fit (not printed)

module ghosts() {
  color("WhiteSmoke") translate(bb_at + [1, 1, 0]) cube([bb[0] - 2, bb[1] - 2, 9.5]);
  color([0.1, 0.1, 0.12]) translate([usb_x - 14, bb_at[1] + bb[1] - 56, 9.5]) cube([28, 55, 6]);
  color("Silver") translate([usb_x - 4, bb_at[1] + bb[1] - 1, 12]) cube([8, 22, 5]);
  color("White") translate([dht_x - dht_body[0] / 2, 0.2, dht_z]) cube(dht_body);
  color("White") translate([pir[0], -wall, pir[1]]) rotate([-90, 0, 0]) translate([0, 0, -7]) sphere(d = 23);
  color("SeaGreen") translate([pir[0] - 16, pir_skirt, pir[1] - 12]) cube([32, 1.6, 24]);
  color("Silver") translate([W - 15, mq[0], mq[1]]) rotate([0, 90, 0]) cylinder(h = 15, d = 19.8);
  color("Black") translate([mic[0], 0.2, mic[1]]) rotate([-90, 0, 0]) cylinder(h = 7, d = 9.7);
  color("DimGray") translate([spk[0], spk[1], H - 22]) cylinder(h = 16, d = 40);
}

module assembly() {
  color("SlateGray") base();
  color("SlateGray", 0.45) lid();
  ghosts();
}

if (part == "base") translate([0, 0, floor_t]) base();
else if (part == "lid") translate([0, 0, H + lid_t]) rotate([180, 0, 0]) lid();
else if (part == "assembly") assembly();
else if (part == "inside") { color("SlateGray") base(); ghosts(); }
