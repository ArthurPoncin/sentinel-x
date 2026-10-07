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

La mesure de la vision (10,6 ms par image) est celle du PC, dans [`../../ai/README.md`](../../ai/README.md#performance-on-the-pi-4--benchmark-monday) : une fois le benchmark fait sur le Pi 4 (#46), mettre son chiffre à la place, diapositive 9.

## Le fichier à déposer

Le sujet nomme un `Workshop2026-M1-G<n>-Pres.pptx`. Ctrl+P dans la page, « Enregistrer au format PDF », marges « aucune », graphiques d'arrière-plan cochés : une page par diapositive, tout affiché, sans les animations.
