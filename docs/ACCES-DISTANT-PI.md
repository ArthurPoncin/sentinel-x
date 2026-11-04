# Ouvrir le dashboard depuis n'importe où

Pas à pas, du Pi qui marche sur la table au dashboard joignable depuis Internet, sur `https://sentinel-x.<tailnet>.ts.net/`, par **Tailscale Funnel**. Le Pi ouvre lui-même la connexion vers Tailscale : aucun port à ouvrir, aucun DNS à toucher, et le Wi-Fi de la table reste isolé. Le détail technique est dans [`infra/README.md`](../infra/README.md#the-dashboard-from-anywhere).

À faire **après** [l'installation](INSTALLATION-PI.md), une fois que le dashboard marche sur la table. Compte 15 minutes.

> **La clé Tailscale (`tskey-auth-…`) ne s'écrit jamais dans le dépôt, ni dans un chat, ni dans un commit.** Le dépôt est public : avec elle, n'importe qui ajoute une machine à votre tailnet. Elle ne va qu'à un endroit, `infra/secrets/tunnel.env` sur le Pi, par la commande de l'étape 4. Une clé qui a traîné ailleurs : *Settings → Keys → Revoke* dans la console, et une nouvelle.

## 1. Dans la console Tailscale (une fois)

Sur [login.tailscale.com/admin](https://login.tailscale.com/admin) :

1. **DNS** : *MagicDNS* activé, puis **Enable HTTPS…**. Le nom affiché sous *Tailnet DNS name* (`tail….ts.net`) est la fin de l'adresse du dashboard.
2. **Access controls**, dans l'éditeur JSON : Funnel autorisé, ce bloc à la suite de `"ssh"`, puis **Save** :
   ```jsonc
   "nodeAttrs": [
       {"target": ["autogroup:member"], "attr": ["funnel"]},
   ],
   ```
3. **Settings → Keys → Generate auth key…** : réglages par défaut (usage unique). Garde la clé pour l'étape 4, nulle part ailleurs.

## 2. Se connecter au Pi

**Branche l'Ethernet du Pi** sur un réseau qui a Internet : il en a besoin tant que l'adresse doit répondre. Puis, depuis le PC Opérateur :

```bash
ssh ton-utilisateur@192.168.4.1          # 4 = numéro de la table ; ou sentinel-x.local avant le durcissement
```

## 3. Récupérer le code

```bash
cd ~/sentinel-x && infra/update.sh
```

Il récupère le code et ses images. Vérifie que le tunnel est là :

```bash
ls docker-compose.tunnel.yml infra/tailscale/serve.json
```

## 4. Donner la clé au Pi

```bash
read -rsp 'Auth key: ' k && (umask 077 && printf 'TS_AUTHKEY=%s\n' "$k" >infra/secrets/tunnel.env); unset k
```

Colle la clé puis Entrée : **rien ne s'affiche**, c'est normal. Elle n'arrive ni à l'écran ni dans l'historique du shell, et le fichier n'est lisible que par toi.

## 5. Démarrer le tunnel

```bash
infra/plug-and-play.sh --no-flash
```

Il peut demander le mot de passe sudo. À l'étape *Webcam USB*, une ligne dit `Tailscale Funnel : le dashboard sur son adresse publique`. Puis :

```bash
docker compose ps tunnel                 # Up
docker compose logs tunnel               # aucune erreur, pas de « x509 »
```

## 6. Garder la machine dans le tailnet

Dans la console, **Machines → sentinel-x → ⋯ → Disable key expiry**. Sans ça, le Pi sort du tailnet au bout de 180 jours et l'adresse ne répond plus.

## 7. Tester

Depuis un téléphone **en 4G**, pas sur le Wi-Fi : `https://sentinel-x.<tailnet>.ts.net/` (ton nom de tailnet de l'étape 1). La page de connexion s'affiche, avec un cadenas normal : rien à installer, le certificat est celui de Tailscale. Connecte-toi avec le mot de passe Opérateur : les mesures arrivent en direct, la caméra aussi.

La première fois, l'adresse peut mettre une dizaine de minutes à répondre.

## 8. Après le durcissement

Si le Pi a déjà été durci, ou après chaque `plug-and-play.sh` : relance `cyber/harden.sh` comme d'habitude ([`DURCISSEMENT-PI.md`](DURCISSEMENT-PI.md)). Le tunnel n'en souffre pas : il sort du Pi, rien n'entre.

## Ce que ça change pour la sécurité

- **Tout Internet arrive sur la page de connexion.** La caméra et la sirène restent derrière le mot de passe Opérateur : il doit être solide.
- Les 5 essais de connexion par minute sont **partagés par tous les visiteurs du tunnel**. Le Wi-Fi de la table garde les siens.
- Pour réserver l'adresse à l'équipe : retire le bloc `"AllowFunnel"` de [`infra/tailscale/serve.json`](../infra/tailscale/serve.json), puis `docker compose restart tunnel`. Elle ne répond alors qu'aux appareils de l'équipe où Tailscale est installé et connecté.
- Ne publie pas l'adresse (README, rapport, slides) : les autres équipes font le pentest.

## Dépannage

| Ce que tu vois | Quoi faire |
|---|---|
| `docker compose logs tunnel` dit `x509` | Le tunnel refuse le certificat du proxy. Envoie le message à l'équipe infra |
| La page s'affiche, mais pas de direct (mesures figées), et une Alerte `cyber` `feed-origin` | Le tunnel ne garde pas l'adresse demandée. `docker compose logs tunnel api` à l'équipe infra |
| `funnel` refusé, ou « not allowed » dans les journaux | Le bloc `nodeAttrs` de l'étape 1 manque : ajoute-le, puis `docker compose restart tunnel` |
| L'adresse ne répond pas, ou erreur de certificat | *Enable HTTPS* de l'étape 1, puis attendre 10 minutes |
| Le tunnel redémarre en boucle, « invalid key » ou « expired » | Clé déjà utilisée ou périmée : une nouvelle (étape 1.3), l'étape 4 à nouveau, puis `docker compose rm -sf tunnel && docker volume rm sentinel-x_tunnel-state && docker compose up -d` |
| Rien ne passe | L'Ethernet du Pi : `ping -c 3 tailscale.com` |

## Fermer l'accès

```bash
docker compose rm -sf tunnel
rm infra/secrets/tunnel.env
infra/plug-and-play.sh --no-flash
```

Puis, dans la console, **Machines → sentinel-x → Remove**.
