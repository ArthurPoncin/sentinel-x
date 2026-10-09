# Dossier d'ingénierie

Le `Workshop2026-B4-G<n>-<NOMS>-Dossier.pdf` à déposer (issue #52) : 10 pages A4, puis le poster A3 en dernière page. Le texte est dans [`dossier.html`](dossier.html), les valeurs à relever dans [`donnees.json`](donnees.json).

## Le construire

```bash
node docs/dossier/build.mjs
```

Il écrit `docs/livrables/Workshop2026-B4-G<n>-<NOMS>-Dossier.pdf` et liste ce qui reste à compléter. Il lui faut un Chromium : celui de Playwright s'il est installé, celui du système, ou `CHROME=/chemin/vers/chrome`. Aucun paquet npm.

Tant que `groupe` ou `noms` est vide, le fichier s'appelle `Workshop2026-B4-GX-Dossier.pdf`.

## Ce qui se complète

Dans le PDF, tout ce qui manque porte l'étiquette « à relever ».

| Quoi | Où |
|---|---|
| Numéro de table | `donnees.json` : `table` (le groupe, G2, et les noms du fichier, `noms`, y sont) |
| Durcissement appliqué ou non | `donnees.json` : `durcissement.applique`. À `false`, le dossier dit que `cyber/harden.sh` est prêt mais pas lancé sur le Pi, avec le motif. À `true`, il le décrit comme en place et attend les trois preuves |
| Preuves du durcissement | `preuves/nmap-tcp.txt`, `preuves/nmap-udp.txt`, `preuves/checklist-durcissement.txt` : les trois fichiers de [`../DURCISSEMENT-PI.md`](../DURCISSEMENT-PI.md), étape 5 |
| Benchmark de la vision sur le Pi 4 | `donnees.json` : `vision_pi4` (`p50`, `p95`, en ms) |
| Modèle prédictif entraîné sur le Sentinel | `donnees.json` : `predictif_reel` |
| Audit | `donnees.json` : `audit`. Avec `"mode": "attendu"`, la section 5 donne pour chaque contrôle le comportement du système et ce qui le garantit (`fonde`, `appui` : `tests`, `config` ou `durcissement`), sans rien présenter comme observé sur le Pi. Avec `"mode": "releve"`, elle attend ce qui a été observé et un verdict |

Pour l'audit : `verdict` vaut `ok`, `ecart` ou `ko`. Un constat s'écrit `{ "id": "C1", "systeme": "…", "criticite": "…", "constat": "…", "correctif": "…", "etat": "…" }` ; sans constat, mettre `"aucun_constat": true`.

## Les schémas de câblage

Ce sont ceux des fiches de l'équipe, [`../cablage/esp32.html`](../cablage/esp32.html) et [`../cablage/raspberry-pi.html`](../cablage/raspberry-pi.html). [`cablage.mjs`](cablage.mjs) en sort les trois schémas vers `img/cablage-*.svg`, sur fond blanc et avec les polices du dossier. Quand une fiche change :

```bash
node docs/dossier/cablage.mjs               # les fiches du dossier de travail
node docs/dossier/cablage.mjs origin/main   # ou celles d'une branche
node docs/dossier/build.mjs
```

Pour un autre schéma, le déposer en `img/cablage.png` (ou `.jpg`, `.svg`) : il remplace les trois, sur une seule page. Les GPIO du moteur cités dans le tableau sont dans `donnees.json` (`moteur_gpio`).

## Les images

La couverture et le poster montrent le Twin tel qu'il est le 8 octobre 2026, pris en mode capture (`/twin?capture`). Si le Twin change, les reprendre et remplacer les fichiers de `img/`.

Les 1 483 tests cités sont ceux de la CI sur `main` le 9 octobre (255 backend, 776 dashboard, 437 IA, 15 leap) : à corriger dans `dossier.html` si le compte bouge.
