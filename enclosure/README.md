# enclosure/ : les boîtiers à imprimer

Trois objets, sept fichiers STL dans [`stl/`](stl/), chacun déjà posé dans le bon sens pour l'impression. Aucun ne demande de support.

| Objet | Ce qu'il contient | Taille hors tout |
|---|---|---|
| **Poste de commande** | Raspberry Pi 4, écran Joy-IT 5 pouces HDMI 800×480 en façade, carte ULN2003 ; sur le toit, une tour de 30 mm avec le moteur 28BYJ-48 dedans et la Logitech C920 sur son support | 150 × 140 × 110 mm, 140 mm en haut de la tour, 195 mm en haut de la C920 |
| **Sentinel** | ESP32 sur son support, ses fils réunis dans des WAGO 221, DHT22, MQ-2, PIR HC-SR501, micro CZN-15E, enceinte 70 × 30 mm | 151 × 155 × 61 mm |
| **Support Leap Motion** | Le Leap Motion Controller d'origine, à plat sur le bureau de l'Opérateur | 128 × 58 × 15 mm |

| Poste de commande | Arrière | Intérieur |
|---|---|---|
| ![](apercu/poste-de-commande.png) | ![](apercu/poste-de-commande-arriere.png) | ![](apercu/poste-de-commande-interieur.png) |

| Sentinel | Intérieur, vu de dessus | Support Leap Motion |
|---|---|---|
| ![](apercu/sentinel.png) | ![](apercu/sentinel-interieur.png) | ![](apercu/support-leap.png) |

## Les fichiers

| Fichier | Pièce | Posée sur le plateau par |
|---|---|---|
| `command-post-shell.stl` | Coque : toit et trois murs | le toit |
| `command-post-base.stl` | Socle : le Pi, la carte ULN2003 | le dessous |
| `command-post-bezel.stl` | Façade : la fenêtre de l'écran, les quatre plots où il se visse | la face avant |
| `command-post-tower.stl` | Tour de la caméra : le moteur sous son sommet | le sommet |
| `sentinel-base.stl` | Boîte du Sentinel : fond, murs, compartiments, support de l'ESP32, logements des WAGO | le fond |
| `sentinel-lid.stl` | Couvercle du Sentinel, avec le cadre de l'enceinte | le dessus |
| `leap-stand-stand.stl` | Support du Leap Motion | le dessous |

## Impression

Sur la Creality K2 Plus du myDiL (350 mm de plateau : chaque pièce passe en une fois).

- **Matière** : PLA pour le Poste de commande et le Leap. **PETG** de préférence pour le Sentinel : la chauffe du MQ-2 dégage près d'un watt dans son compartiment.
- Couches de 0,2 mm, 3 périmètres, remplissage 15 à 20 % (gyroïde), sans support, sans bordure.
- Au plus 750 g de filament pour le tout (le volume plein des pièces), moins avec le remplissage.

## Visserie et petit matériel

| Pour | Quoi |
|---|---|
| Le Pi sur le socle | 4 vis M2,5 × 6 |
| Le socle sous la coque | 4 vis M3 × 12 tête fraisée, par en dessous |
| La tour sur le toit | 3 vis M3 × 10, par l'intérieur du boîtier |
| Le moteur dans la tour | 2 vis M3 × 8 tête fraisée et 2 écrous M3 |
| L'écran sur la façade | 4 vis M2,5 × 8, par les trous de ses oreilles |
| Le câble HDMI de l'écran | Un adaptateur HDMI coudé à 90°, mâle-femelle, dont la sortie part vers l'arrière (à l'opposé de la vitre) |
| L'alimentation de l'écran | 2 fils Dupont mâle-femelle, ou un câble micro-USB coudé |
| La carte ULN2003 | 4 vis M3 × 6, ou un carré d'adhésif double face mousse si ses trous ne tombent pas (prévus à 29,5 × 27 mm) |
| Le couvercle du Sentinel | 4 vis M3 × 12 tête fraisée |
| Les branchements du Sentinel | Des WAGO 221 : 2 × 221-415, 4 × 221-413, 3 × 221-412. Des câbles Dupont mâle-femelle : le côté femelle sur la broche, le côté mâle dans le WAGO |
| Le PIR | 2 vis M2 × 6, ou un point de colle chaude |
| Le micro, le MQ-2, l'enceinte | Colle chaude |
| Sous chaque boîtier et sous le Leap | 4 patins caoutchouc de 10 mm |
| Option : ventilateur 30 × 30 mm 5 V sous la grille du toit | 4 vis M3 × 16, ses fils sur les broches 1 (3,3 V : il tourne moins vite, sans bruit) et 9 (GND) du Pi, le 5 V étant pris par l'écran et le moteur |

## Montage du Poste de commande

1. **Écran sur la façade.** Vitre contre la façade, **son connecteur HDMI en haut** : les quatre oreilles de sa carte tombent sur les quatre plots. Quatre vis M2,5 × 8 ; serrées, elles plaquent la vitre contre la fenêtre.
   L'adaptateur HDMI coudé se branche dessus, sa sortie vers l'arrière : le câble passe sous le toit, au-dessus du Pi, et redescend au fond vers le micro-HDMI 1. Il reste 20 mm entre le haut de la carte et le toit.
2. **Pi sur le socle.** Carte SD vers la droite (l'encoche du mur droit la laisse accessible), connecteur GPIO vers l'avant, ports USB et Ethernet vers la gauche. Quatre vis M2,5.
3. **Carte ULN2003** sur les quatre plots du coin arrière gauche.
4. **Moteur dans la tour.** Son axe sort par le trou du sommet, le capot de ses fils vers l'arrière. Deux vis fraisées par le dessus, les écrous dessous, sur ses pattes.
   **Tour sur le toit.** Elle se pose dans son logement, le triangle gravé vers l'avant (ses trois vis ne tombent que dans ce sens), et se visse par l'intérieur de la coque avec trois vis M3 × 10. Le fil du moteur descend dans le boîtier par le trou du toit.
5. **Support de la caméra** : celui que l'équipe a déjà imprimé (`support_c920_28byj48.stl`), enfoncé sur l'axe du moteur. Le haut de la tour est creusé autour de l'axe : son cône ne frotte pas.
6. **Webcam.** La C920 se visse sur le pas de vis du support, son clip replié dessous, **sa lentille au-dessus du triangle gravé** sur la tour : elle regarde droit devant. C'est le zéro du moteur, à refaire avant chaque démarrage (il compte ses pas depuis là). Son câble entre dans la tour par le trou à l'arrière gauche, juste sous le support, et descend jusqu'à un port USB du Pi. Laisse-lui du mou : la caméra tourne d'un quart de tour de chaque côté.
7. **Câblage**, comme sur [`docs/cablage/raspberry-pi.html`](../docs/cablage/raspberry-pi.html) : broches 31, 33, 35, 37 vers IN1 à IN4, 39 vers −, 4 vers + ; le moteur dans la prise blanche de l'ULN2003 ; l'écran sur le micro-HDMI 1. On n'enfiche pas l'écran sur le GPIO comme le prévoit Joy-IT : son connecteur couvrirait les broches 1 à 26, dont la 4 du moteur. Il s'alimente par deux fils Dupont mâle-femelle, de la broche 2 (5 V) et de la broche 6 (GND) du Pi vers les mêmes broches de son connecteur noir, au dos ; ou par son micro-USB sur un port USB du Pi, avec un câble coudé (11 mm seulement jusqu'au mur droit). Si l'image est à l'envers, ajouter `,rotate=180` après `video=HDMI-A-2:800x480M@60D` dans `/boot/firmware/cmdline.txt`. Le câble USB de l'ESP32 et, si besoin, l'Ethernet passent dans l'encoche arrière gauche, l'alimentation USB-C dans l'encoche arrière droite. Toutes les fiches restent dedans : à l'arrière ne sortent que l'alimentation et le câble de l'ESP32, plus l'Ethernet s'il est branché.
8. **Fermeture.** La tour vissée avant (ses vis sont au-dessus de la façade), la façade debout dans la rainure à l'avant du socle, on descend la coque par-dessus : la façade glisse dans les rainures des murs jusqu'à celle du toit. Quatre vis M3 × 12 par-dessous.

## Montage du Sentinel

1. **ESP32.** Les fiches Dupont d'abord, sur ses broches, hors de la boîte. Puis il descend entre ses deux supports, **son USB vers le mur du fond**, et se clipse sous leurs petites lèvres. Ses fiches pendent dessous : 26 mm de place.
   **WAGO** dans leurs logements, le long des murs gauche et droit : leviers en haut, ouvertures vers l'ESP32. Le nom de chacun est gravé à côté, dans le fond :

   | Gravé | WAGO | Ce qui y entre |
   |---|---|---|
   | 3V3 | 221-415 | 3V3 de l'ESP32, VCC du DHT22, VCC du CZN-15E, une patte de la 10 kΩ du DHT22 |
   | IO4 | 221-413 | IO4 de l'ESP32, DATA du DHT22, l'autre patte de cette 10 kΩ |
   | GND | 221-415 | Un GND de l'ESP32, GND du DHT22, du MQ-2, du PIR et du CZN-15E |
   | 5V | 221-413 | 5V de l'ESP32, VCC du MQ-2, VCC du PIR |
   | GND, à droite | 221-413 | Un autre GND de l'ESP32, le fil noir de l'enceinte, une patte de la 20 kΩ |
   | AO | 221-412 | AO du MQ-2, une patte de la 10 kΩ du pont |
   | IO34 | 221-413 | IO34 de l'ESP32, l'autre patte de cette 10 kΩ, l'autre patte de la 20 kΩ |
   | IO25 | 221-412 | IO25 de l'ESP32, une patte de la 100 Ω |
   | HP+ | 221-412 | L'autre patte de la 100 Ω, le fil rouge de l'enceinte |

   Deux fils vont directement, sans WAGO, par un câble Dupont femelle-femelle : OUT du CZN-15E sur IO26, OUT du PIR sur IO27. Les pattes de résistance tiennent dans un WAGO 221 comme un fil.
2. **DHT22** glissé par le haut dans son support, grille contre les fentes, posé sur ses deux piliers : ses quatre fiches Dupont passent dessous. Ses fils sortent du compartiment par le passage au ras du fond.
3. **MQ-2** : sa capsule dans le berceau du mur droit, face aux trous, un point de colle chaude sur la carte (pas sur la capsule, qui chauffe). Fils par le passage de son compartiment.
4. **PIR** : le dôme sort par le trou de la façade, la carte se visse sur les deux plots (M2) ou se colle. Ses deux potentiomètres et son cavalier restent accessibles couvercle ouvert.
5. **CZN-15E** : sa capsule dans le petit berceau, face aux trous, un point de colle.
6. **Enceinte** dans son cadre sous le couvercle, sa face contre les fentes, un cordon de colle chaude autour. Elle descend à 38 mm du fond, au-dessus des WAGO de droite. Fils assez longs pour ouvrir le couvercle.
7. Une fois câblé comme sur [`docs/cablage/esp32.html`](../docs/cablage/esp32.html), un bout de mousse ou de ruban bouche les deux passages de fils : la chaleur du MQ-2 reste dans son compartiment, loin du DHT22.
8. Le câble USB couché dans l'encoche du fond, le couvercle se visse aux quatre coins (M3 × 12 fraisées).

## Support Leap Motion

Le capteur se pose dans le creux, sa LED verte vers l'Opérateur ; son câble sort par l'un ou l'autre bout. L'encoche à l'arrière sert à le soulever. Le dessus du capteur dépasse le bord : rien ne gêne son champ de vision.

## Gravure laser

Le sujet demande des plaques gravées (logo, consignes, numéro de série) sur le boîtier. Deux logements de 1 mm de profondeur les attendent :

- Poste de commande, mur gauche : **100 × 40 mm**, plaque à découper à 99,4 × 39,4 mm ;
- Sentinel, couvercle : **70 × 40 mm**, plaque à 69,4 × 39,4 mm.

En plexiglas ou contreplaqué de 3 mm sur la Creality Falcon A1, collées.

## Ce qui a été supposé, à vérifier avant d'imprimer

Toutes ces cotes sont en tête des fichiers `.scad`. Après un changement, `./build.sh` refait les STL et les aperçus (OpenSCAD 2024 ou plus récent : `brew install --cask openscad@snapshot`).

| Cote | Valeur prise | Fichier, variable | Si c'est faux |
|---|---|---|---|
| **Écran Joy-IT RB-LCD-5** : carte, trous des oreilles, zone affichée | 121,1 × 78 mm, trous à 115,1 × 83,9 mm, 110,7 × 67,4 mm. D'après les plans de la Waveshare 5inch HDMI LCD, dont elle reprend la carte (Joy-IT donne 120 × 79 mm hors oreilles) | `command-post.scad`, `scr`, `scr_holes`, `scr_view`, `scr_view_off` | Mesurer l'entraxe des trous : seule la façade change, sauf si l'écran est plus grand |
| Place pour l'adaptateur HDMI coudé | 20 mm au-dessus de la carte | `hdmi_room` | Avec un câble droit sans adaptateur, 45 mm : le boîtier grandit de 25 mm |
| ESP32 DevKitC V4 d'AZ-Delivery | 56 × 28 mm | `sentinel.scad`, `esp` | Les supports s'écartent ou se rapprochent seuls |
| WAGO 221 | 13,1 / 18,7 / 29,9 mm de large (2, 3, 5 pôles), 18,6 mm de profondeur | `wago_w`, et leur liste dans `wago_left`, `wago_right` | Un point de colle chaude |
| Trous de la carte ULN2003 | 29,5 × 27 mm | `uln_holes` | Adhésif mousse sur les plots |
| Pied carré de la lentille du PIR | 4 mm entre le mur et sa carte | `sentinel.scad`, `pir_skirt` | Un point de colle |
| Capsule du MQ-2, du micro | Ø 19,8 mm, Ø 9,7 mm | `cradle(...)` dans `sentinel.scad` | Colle chaude |
| Leap Motion d'origine | 80 × 30 mm | `leap-stand.scad`, `leap` | — |

Mesurés : l'enceinte (70 × 30 × 18 mm, par l'équipe) et le support de caméra déjà imprimé (Ø 30 mm, cône de 45°, axe à méplats de 6,5 mm de profondeur). La C920 d'après la fiche de Logitech : 94 × 24 × 29 mm, 162 g.

Les sources sont les fichiers `.scad` : `common.scad` (outils partagés), `command-post.scad`, `sentinel.scad`, `leap-stand.scad`. Chacun prend `part="..."` : une pièce posée pour l'impression, `assembly` le boîtier monté avec ses composants en couleur, `inside` son intérieur.
