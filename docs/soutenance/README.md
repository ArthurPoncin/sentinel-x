# Soutenance : le diaporama

Le support de la soutenance du vendredi (issue #53) : [`index.html`](index.html), une seule page, sans réseau. Le Wi-Fi de la table n'a pas Internet, la page n'en demande pas. Ses couleurs sont celles du dashboard, ses images sont les captures du Twin de [`../twin/`](../twin/).

## L'ouvrir

Double-clic sur `index.html` (Chrome, Chromium ou Firefox), puis **F** pour le plein écran. Le dossier `docs/` doit rester entier : la page lit les captures de `../twin/` et le teaser, `../livrables/sentinel-x-teaser.mp4`.

| Touche | Effet |
|---|---|
| → · Espace · Page suivante (télécommande) | avancer |
| ← · Page précédente | reculer |
| F | plein écran |
| O | le plan : toutes les diapositives, un clic pour y aller |
| N | les notes de l'orateur, à l'écran : pour répéter, pas devant le jury |
| B | écran noir, pendant la démo sur le dashboard |

Un clic avance, un clic dans le cinquième gauche de l'écran recule. `index.html#7` ouvre la diapositive 7.

## Les dix minutes

Le chrono du sujet, à la seconde. La barre du bas découpe les dix minutes en leurs quatre parties, et son trait de couleur dit où le plan place la diapositive affichée. La page ne chronomètre rien : c'est à l'orateur de tenir sa montre.

| Temps | Diapositives | Contenu |
|---|---|---|
| 0:00 à 1:00 | 1 à 3 | le titre, les trois menaces, l'équipe et l'Option A |
| 1:00 à 2:00 | 4 | le teaser « Sentinel Drop » |
| 2:00 à 5:00 | 5 | la démo live, ses six temps (ceux de [`../SCOPE.md`](../SCOPE.md)) et le plan B |
| 5:00 à 10:00 | 6 à 13 | les attendus du sujet, l'architecture, le Sentinel, l'IA, la sécurité, le Twin, les chiffres, les questions |

- **Le teaser** : la diapositive 4 est une salle de projection. → lance le film sur son écran, avec le son, et la salle s'éteint ; → de nouveau passe à la démo, ← l'arrête. En attendant, l'écran montre une image du film.
- **La démo** : → fait passer le repère d'un temps au suivant, et la page prend la couleur du Status attendu. **B** noircit la page si elle reste projetée.

## Le modifier

Tout est dans `index.html`. Une diapositive est une `<section class="slide">` : `data-t` est son temps en secondes (la somme fait 600), `data-status` sa couleur (`nominal`, `elevated`, `critical`, `replay`), `<aside class="notes">` ses notes. Les noms et les rôles de l'équipe sont dans le tableau `TEAM`, au début du script.

Les chiffres de la diapositive 12 sont ceux de `main` le 7 octobre 2026. Avant vendredi, les relever de nouveau :

```bash
npm test --prefix backend && npm test --prefix dashboard     # 255 et 637 tests
(cd ai && .venv/bin/pytest --collect-only -q | tail -1)      # 392 tests
git rev-list --count origin/main                             # commits
gh pr list --state merged --limit 500 --json number --jq length
gh issue list --state closed --limit 500 --json number --jq length
```

L'image du titre, [`../twin/outpost-alone.png`](../twin/outpost-alone.png), est le Twin seul : `/twin?capture` dans une fenêtre de 1240 × 1080, Status nominal, puis le noir du fond rendu transparent, pour que seul ce qui est éclairé se pose sur la page. Si le Twin change d'ici vendredi, refaire la capture, puis :

```python
import numpy as np
from PIL import Image

rgb = np.asarray(Image.open('capture.png').convert('RGB')).astype(np.float32)
alpha = np.clip(rgb.max(axis=2) / 64, 0, 1)  # opaque dès qu'un canal atteint 64, transparent au noir
colour = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha, 1 / 255)[..., None], 0)
height, width = alpha.shape
y, x = np.mgrid[0:height, 0:width]
radius = np.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2))
alpha *= np.clip((1 - radius) / 0.15, 0, 1)  # plus rien au bord du cadre
rgba = np.dstack([np.clip(colour, 0, 255), alpha * 255]).round().astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save('docs/twin/outpost-alone.png', optimize=True)
```

La mesure de la vision (10,6 ms par image) est celle du PC, dans [`../../ai/README.md`](../../ai/README.md#performance-on-the-pi-4--benchmark-monday) : une fois le benchmark fait sur le Pi 4 (#46), mettre son chiffre à la place, diapositive 9.

## Le fichier à déposer

Le dépôt attend un `Workshop2026-B4-G<n>-<NOMS>-pres.pptx` (PPTX ou équivalent). Ctrl+P dans la page, « Enregistrer au format PDF », marges « aucune », graphiques d'arrière-plan cochés : une page par diapositive, tout affiché, sans les animations.
