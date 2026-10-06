# Installer le Command Post sur le Raspberry Pi

Pas à pas, de la carte SD vierge au dashboard qui affiche les mesures du Sentinel. Tout repose sur [`infra/plug-and-play.sh`](../infra/plug-and-play.sh) : il configure le Pi, démarre la stack et flashe l'ESP32 branché en USB. Détails techniques : [`infra/README.md`](../infra/README.md) et [`firmware/README.md`](../firmware/README.md).

Dans cette page, la table est la n° **4**. Remplace `4` par ton numéro de table partout : le Pi devient `192.168.<table>.1`.

## 0. Le matériel

- Le Raspberry Pi 4, son alimentation officielle (USB-C, 5 V / 3 A) et une carte microSD d'au moins 16 Go.
- Un **câble Ethernet** branché sur un réseau qui a Internet (box, routeur, prise de l'école). Indispensable seulement la première fois.
- L'ESP32 câblé selon [`firmware/include/pins.h`](../firmware/include/pins.h), avec un **câble USB qui transmet les données**. Beaucoup de câbles ne font que charger : avec eux, le Pi ne voit pas l'ESP32.

## 1. Préparer la carte SD (sur ton PC)

Dans **Raspberry Pi Imager** :

1. Appareil : *Raspberry Pi 4*. Système : *Raspberry Pi OS (64-bit)* (la version *Lite* suffit). Stockage : la carte SD.
2. Dans *Modifier les réglages* :
   - nom d'hôte `sentinel-x` ;
   - un nom d'utilisateur et un mot de passe ;
   - fuseau *Europe/Paris* ;
   - pays Wi-Fi **FR** ;
   - onglet *Services* : **activer SSH** ;
   - ne configure **aucun** réseau Wi-Fi : le Wi-Fi du Pi deviendra le point d'accès de la table.
3. Écris la carte.

## 2. Démarrer le Pi

Mets la carte SD dans le Pi. Branche l'**Ethernet**, l'**ESP32 sur un port USB du Pi**, puis l'alimentation. Attends 2 minutes.

## 3. Se connecter au Pi

Depuis ton PC, sur le même réseau :

```bash
ssh ton-utilisateur@sentinel-x.local
```

Si ça ne répond pas (certains réseaux d'école bloquent), branche un écran et un clavier sur le Pi.

## 4. Mettre le Pi à jour

```bash
sudo apt update && sudo apt full-upgrade -y && sudo apt install -y git
sudo reboot
```

Reconnecte-toi après le redémarrage, comme à l'étape 3.

## 5. Vérifier que le Pi voit l'ESP32

```bash
ls /dev/ttyUSB*
```

Ça doit afficher `/dev/ttyUSB0`. Sinon, change de câble USB.

## 6. Lancer le script

```bash
git clone https://github.com/ArthurPoncin/sentinel-x.git
cd sentinel-x
infra/plug-and-play.sh 4
```

- La première fois, compte **15 à 30 minutes** : la construction des images Docker et la compilation du firmware sont longues sur le Pi.
- Le script demande le mot de passe `sudo`, puis **deux fois le mot de passe Opérateur** (12 caractères minimum). Retiens-le : c'est celui du dashboard.

Ce qu'il fait, dans l'ordre :

1. Il installe Docker, PlatformIO, dnsmasq (DHCP) et chrony (heure) tant qu'il y a Internet.
2. Il crée les secrets dans `infra/secrets/` (jamais commités) et démarre la stack.
3. Il compile le firmware avec les secrets de ce Pi : les mots de passe ne quittent jamais le Pi.
4. Il transforme le Wi-Fi du Pi en réseau de la table `SentinelX-4` : 2,4 GHz, WPA2, sans Internet. L'ESP32 a toujours l'adresse `192.168.4.10`, et le Pi lui donne l'heure.
5. Il flashe l'ESP32 par USB, attend sa première mesure sur le broker et l'affiche.

## 7. Lire la fin

- `✓ first snapshot: {"ts":…,"readings":{…}}` : **tout marche**, l'ESP32 envoie ses mesures au Pi.
- **Note la phrase de passe Wi-Fi** affichée à la fin. Elle est aussi gardée dans `infra/secrets/wifi.env`.
- Une ligne avec `!` explique ce qui manque : voir [Dépannage](#dépannage).

## 8. Connecter le PC Opérateur

1. **Récupère le certificat** du Pi, depuis un terminal de ton PC :
   ```bash
   scp ton-utilisateur@sentinel-x.local:sentinel-x/infra/secrets/ca.crt .
   ```
2. **Installe-le comme autorité de confiance** :
   - **Mac** : double-clic sur `ca.crt`, trousseau *Système*. Double-clic ensuite sur « Sentinel-X Team CA », puis *Se fier* → *Toujours approuver*.
   - **Windows** : double-clic, *Installer le certificat* → *Ordinateur local* → magasin *Autorités de certification racines de confiance*.
   - **Firefox** a sa propre liste : *Paramètres → Certificats → Importer*.
3. Connecte le PC au Wi-Fi **`SentinelX-4`** avec la phrase de passe de l'étape 7.
4. Ouvre **`https://192.168.4.1/`** et connecte-toi avec le mot de passe Opérateur.

## 9. Tester

Laisse **1 minute** au MQ-2 et au PIR pour chauffer, puis :

- **Gaz** : approche un briquet **éteint** du MQ-2 et appuie sur le bouton sans l'allumer. La courbe de gaz monte ; au-delà du seuil critique, la sirène sonne.
- **Température** : pose la main sur le DHT22, elle monte doucement.
- **Présence** : passe devant le PIR.
- **Son** : tape dans les mains près du capteur.

Les seuils se règlent dans [`firmware/include/config.h`](../firmware/include/config.h), puis on relance le script pour reflasher.

## Ensuite

- **Au quotidien** : il suffit d'allumer le Pi. Le Wi-Fi de la table, la stack et l'ESP32 redémarrent tout seuls.
- **Mettre à jour** : branche l'Ethernet, puis
  ```bash
  cd ~/sentinel-x && git pull && infra/plug-and-play.sh 4
  ```
- **Ne pas toucher à l'ESP32** en relançant : `infra/plug-and-play.sh 4 --no-flash`.

## Dépannage

L'écran de l'ESP32 dit ce qu'il attend :

| Écran | Quoi faire |
|---|---|
| `Wi-Fi...` | Vérifie le point d'accès avec `nmcli connection show --active`, puis relance le script |
| `MQTT: TLS/reseau` | Vérifie avec `docker compose ps` que `mosquitto` tourne, puis relance le script : il refait le certificat si besoin |
| `MQTT: mot de passe` | Relance le script : il reflashe l'ESP32 avec le bon mot de passe |
| `Heure du Pi...` | `systemctl status chrony` |
| `Temp DHT22 ?` | Câblage du DHT22 et sa résistance de 10 kΩ entre DATA et 3V3. Rien n'est envoyé tant qu'il ne répond pas |
| Couleurs bizarres, bords décalés | Remplace `INITR_BLACKTAB` par `INITR_GREENTAB` dans `firmware/src/display.cpp`, puis relance le script |

Le script lui-même :

| Message | Quoi faire |
|---|---|
| `no ESP32 on USB` | Branche l'ESP32 sur le Pi (câble de données), puis relance |
| `flashing failed` | Maintiens le bouton **BOOT** de l'ESP32 au début de l'envoi, puis relance |
| `missing packages…` / `Docker is missing` | Le Pi n'a pas Internet : branche l'Ethernet, puis relance |
| `NetworkManager is not running` | Le système est trop ancien : réinstalle Raspberry Pi OS (64-bit) récent |
| `camera nodes missing` | Le Pi ne voit pas la caméra : éteins-le, remets la nappe (contacts vers les ports HDMI), vérifie avec `rpicam-hello --list-cameras`, puis relance |

Journaux :

- **l'ESP32 en direct** : `~/.local/share/sentinel-x/platformio/bin/pio device monitor -d firmware` (Ctrl+C pour quitter) ;
- **le Pi** : `docker compose logs -f api mosquitto` ;
- **la caméra** : `docker compose logs -f vision` (« Camera picamera2 up, 640x480 » quand elle marche). Dans le dashboard, une image grise « camera down, retrying » veut dire que `vision` tourne sans caméra.
