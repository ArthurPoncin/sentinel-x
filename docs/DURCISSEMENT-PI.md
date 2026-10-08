# Durcir le Command Post avant le pentest

Pas à pas, du Pi qui marche au Pi qui ne répond plus qu'à ce dont la table a besoin. Tout repose sur [`cyber/harden.sh`](../cyber/harden.sh) : il applique la checklist de [`cyber/README.md`](../cyber/README.md#harden-the-command-post-pi--the-pentest-target), et on peut le relancer autant de fois qu'on veut, il arrive toujours au même état.

À faire **après** [l'installation](INSTALLATION-PI.md), une fois que le dashboard affiche les mesures du Sentinel. Compte 15 minutes.

Dans cette page, la table est la n° **4** et le Pi est `192.168.4.1`. Remplace `4` par ton numéro de table partout.

## Ce que le script change

| | Avant | Après |
|---|---|---|
| **SSH** | mot de passe accepté, depuis n'importe où | clé **ed25519** seulement, `root` refusé, un seul compte, et seulement depuis le **PC Opérateur** |
| **Pare-feu du Pi** (UFW) | tout entre | tout ce qui entre est refusé, sauf SSH depuis le PC Opérateur, le DHCP (67/udp) et l'heure (123/udp) sur le Wi-Fi de la table |
| **Ports publiés par Docker** (443, 8883) | joignables aussi par l'Ethernet. Docker passe à côté d'UFW | joignables depuis le Wi-Fi de la table seulement (chaîne `DOCKER-USER`), y compris après un redémarrage |
| **Services** | `bluetooth`, `avahi-daemon`… tournent | coupés |
| **Adresse du PC Opérateur** | donnée au hasard par le DHCP | toujours la même, puisque SSH ne répond qu'à elle |

Deux conséquences à connaître :

- **`sentinel-x.local` ne répond plus** (c'était `avahi-daemon`). On joint le Pi par son adresse : `192.168.4.1`.
- **SSH ne répond plus qu'au PC Opérateur, sur le Wi-Fi de la table.** Plus par l'Ethernet, plus depuis un autre PC.

## 0. Ce qu'il te faut

- Le **PC Opérateur**, connecté au Wi-Fi de la table `SentinelX-4`. C'est depuis lui qu'on lance tout.
- Un **clavier** à portée de main pour le Pi, en plus de son écran HDMI (Ctrl+Alt+F2 y ouvre une console de connexion, à la place du statut). Le script fait tout pour ne pas t'enfermer dehors, mais si ça arrive, c'est la seule porte : voir [Dépannage](#dépannage).
- La première fois, le **câble Ethernet** sur le Pi : le script installe UFW, il lui faut Internet une fois.

## 1. Donner ta clé SSH au Pi (sur le PC Opérateur)

Le script coupe les mots de passe : il te faut une clé **ed25519** avant.

1. Crée la clé, si tu n'as pas déjà un fichier `~/.ssh/id_ed25519` :
   ```bash
   ssh-keygen -t ed25519
   ```
   Entrée pour l'emplacement proposé. Mets une phrase de passe : c'est elle qui protège la clé si on te prend le PC.
2. Envoie-la au Pi (il demande ton mot de passe, pour la dernière fois) :
   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub ton-utilisateur@192.168.4.1
   ```
   Sous **Windows** (PowerShell), `ssh-copy-id` n'existe pas :
   ```powershell
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ton-utilisateur@192.168.4.1 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
   ```
3. **Déconnecte-toi et reconnecte-toi** :
   ```bash
   ssh ton-utilisateur@192.168.4.1
   ```
   Il ne doit plus demander le mot de passe du compte (au plus la phrase de passe de ta clé). C'est cette session-là qu'il faut pour la suite : le script refuse de continuer si tu es entré avec un mot de passe.

## 2. Récupérer le script et répéter à blanc (sur le Pi, par SSH)

```bash
cd ~/sentinel-x && git pull          # Ethernet branché
cyber/harden.sh 4 --dry-run
```

`--dry-run` ne change rien : il affiche chaque commande qu'il lancerait et chaque fichier qu'il écrirait. Vérifie sa première ligne :

```
==> Table 4: the Pi is 192.168.4.1 · Operator laptop: 192.168.4.100 · SSH account: ton-utilisateur
```

- `Operator laptop` est bien l'adresse de ton PC sur le Wi-Fi de la table (`ip addr` ou `ipconfig` sur le PC) ;
- `SSH account` est bien ton compte sur le Pi.

## 3. Durcir

```bash
cyber/harden.sh 4
```

Il demande le mot de passe `sudo`, puis fait dans l'ordre :

1. Il vérifie que tu pourras encore entrer : ta clé ed25519 est sur le Pi, et ta session est entrée avec.
2. Il installe UFW si besoin.
3. Il coupe les services inutiles.
4. Il filtre les ports de Docker et installe le service qui remet ce filtre à chaque démarrage.
5. Il réserve l'adresse du PC Opérateur dans le DHCP.
6. Il active le pare-feu.
7. En dernier, il passe SSH aux clés seulement. Jusque-là, un mot de passe permettait encore d'entrer.

Il finit par la checklist : chaque ligne doit avoir un `✓`. Les lignes `!` de la dernière partie sont des rappels sur ce que d'autres scripts installent (Wi-Fi, conteneurs), pas des échecs.

## 4. Vérifier, avant de fermer ta session

**Ne ferme pas le terminal du script.** Tant qu'il est ouvert, tu peux réparer.

1. **Ouvre un second terminal** sur le PC Opérateur :
   ```bash
   ssh ton-utilisateur@192.168.4.1
   ```
   Il doit entrer, sans mot de passe de compte. Si non, répare depuis le premier terminal ([Dépannage](#dépannage)).
2. **Le dashboard** `https://192.168.4.1/` répond toujours, et les mesures du Sentinel arrivent toujours.
3. **Redémarre le Pi**, pour être sûr que tout tient :
   ```bash
   sudo reboot
   ```
   Attends 2 minutes, reconnecte-toi, puis :
   ```bash
   cyber/harden.sh 4 --check
   ```
   `--check` ne change rien : il relit la checklist. Tout doit être `✓`, et le dashboard doit remarcher tout seul.

## 5. La preuve pour le dossier (Nmap, depuis le PC Opérateur)

C'est ce qui va dans la **matrice de sécurité** du dossier d'ingénierie.

```bash
sudo nmap -sS -p- -T4 -oN nmap-tcp.txt 192.168.4.1                                   # tous les ports TCP, quelques minutes
sudo nmap -sU -p 53,67,68,69,123,137,161,1900,5353 -oN nmap-udp.txt 192.168.4.1      # les ports UDP courants
```

Ce qu'on doit lire :

| Scan | Attendu |
|---|---|
| TCP | `22/tcp open`, `443/tcp open`, `8883/tcp open`, et rien d'autre : `Not shown: 65532 filtered tcp ports` |
| UDP | `123/udp open` (l'heure). Tous les autres en `open\|filtered` |

En UDP, `open|filtered` veut dire « aucune réponse » : Nmap ne peut pas distinguer un port filtré d'un port ouvert qui se tait. Deux compléments tranchent :

- le DHCP répond bien : `sudo nmap -sU -p 67 --script dhcp-discover 192.168.4.1` ;
- côté Pi, `cyber/harden.sh 4 --check` liste les règles du pare-feu et, à la fin, tout ce qui écoute sur le Pi.

Deux contrôles de plus, si tu as un second PC :

- **depuis un autre PC de la table** : `nmap -p 22,443,8883 192.168.4.1` doit donner `22/tcp filtered`, les deux autres `open` ;
- **depuis le réseau Ethernet** du Pi : les trois doivent être `filtered`.

À mettre dans le dossier : `nmap-tcp.txt`, `nmap-udp.txt`, et la sortie de la checklist :

```bash
cyber/harden.sh 4 --check | tee checklist-durcissement.txt
```

Ces trois fichiers ne contiennent aucun secret.

## Ensuite

- **Se connecter au Pi** : depuis le PC Opérateur, sur le Wi-Fi de la table, `ssh ton-utilisateur@192.168.4.1`.
- **Mettre à jour** : branche l'Ethernet, puis
  ```bash
  cd ~/sentinel-x && infra/update.sh
  ```
  Il ne touche ni au Wi-Fi ni au pare-feu : ta session SSH tient, et le durcissement reste en place. S'il dit à la fin que l'installation du Pi ou le durcissement a changé :
  ```bash
  infra/plug-and-play.sh 4 --no-flash && cyber/harden.sh 4
  ```
  `plug-and-play.sh` relance le Wi-Fi de la table : ta session SSH se fige quelques secondes, puis reprend. Si elle tombe, reconnecte-toi et relance la même commande : les deux scripts reprennent sans rien casser.
- **Changer de PC Opérateur** : depuis l'ancien, donne la clé du nouveau au Pi (étape 1, en ajoutant sa clé publique à `~/.ssh/authorized_keys`), connecte le nouveau au Wi-Fi de la table, regarde son adresse, puis :
  ```bash
  cyber/harden.sh 4 --operator 192.168.4.123
  ```
- **Le PC Opérateur a changé d'adresse** (carte Wi-Fi changée, « adresse privée » du Wi-Fi activée ou désactivée) : SSH ne lui répond plus. Au clavier du Pi : `cyber/harden.sh 4 --operator <sa nouvelle adresse>`.

## Dépannage

Ce que dit le script quand il s'arrête. Sauf pour la dernière ligne, il n'a alors rien changé à SSH :

| Message | Quoi faire |
|---|---|
| `has no ed25519 key` | Fais l'étape 1 |
| `this session logged in with a password` | Ta clé est sur le Pi mais ta session ne l'a pas utilisée : déconnecte-toi, reconnecte-toi, vérifie qu'il ne demande plus le mot de passe du compte |
| `is not on the table Wi-Fi` | Tu es entré par l'Ethernet ou par `sentinel-x.local` : connecte le PC au Wi-Fi `SentinelX-4` et entre par `ssh ton-utilisateur@192.168.4.1` |
| `which laptop is the Operator's?` | Lancé au clavier du Pi ou avec `sudo` devant : relance sans `sudo`, ou ajoute `--operator <adresse du PC Opérateur>` |
| `UFW is missing and there is no Internet` | Branche l'Ethernet, puis relance |
| `another file in /etc/ssh/sshd_config.d comes before` | `ls /etc/ssh/sshd_config.d/` : un fichier classé avant `00-sentinel-x.conf` remet les mots de passe. Retire-le, puis relance |
| `N line(s) of the checklist do not hold` | Lis les lignes `✗` au-dessus, puis relance `cyber/harden.sh 4` |

**SSH ne répond plus.** Branche un clavier sur le Pi, passe sur une console de connexion avec **Ctrl+Alt+F2** (l'écran HDMI affiche le statut sur la première), connecte-toi, puis :

```bash
sudo ufw allow in on wlan0 to any port 22 proto tcp                                # SSH rouvert à toute la table
sudo rm /etc/ssh/sshd_config.d/00-sentinel-x.conf && sudo systemctl reload ssh     # les mots de passe reviennent
```

Répare (ta clé, l'adresse du PC), puis relance `cyber/harden.sh 4` : il referme tout.

**Tout défaire**, si le durcissement gêne la démo et qu'il n'y a pas le temps de chercher :

```bash
sudo ufw disable
sudo systemctl disable --now sentinel-x-docker-filter && sudo iptables -F SENTINEL-X
sudo rm /etc/ssh/sshd_config.d/00-sentinel-x.conf && sudo systemctl reload ssh
sudo systemctl enable --now avahi-daemon
```

Le Pi revient à l'état d'après l'installation. `cyber/harden.sh 4` le redurcit quand tu veux.
