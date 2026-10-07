# Rapport d'audit — Pentest croisé

> Modèle à remplir le jeudi après le pentest croisé. Il couvre les deux volets : ce que les autres tables ont trouvé chez nous (et nos correctifs), et ce qu'on a trouvé chez une table consentante. La synthèse va dans la **matrice de sécurité** du dossier d'ingénierie (#52). La méthode et les règles sont dans [`PENTEST-PLAN.md`](PENTEST-PLAN.md).

- **Équipe :** G\<n\>
- **Table / sous-réseau :** `192.168.<n>.0/24`
- **Date :** jeudi \<date\>
- **Auditeurs (notre équipe) :** …
- **Table auditée par nous :** G\<cible\> — `192.168.<cible>.0/24`
- **Table(s) nous ayant audités :** …

---

## 1. Résumé

Deux ou trois phrases : posture de sécurité constatée, nombre de constats par criticité, correctifs appliqués pendant l'après-midi.

| Criticité | Chez nous | Chez la cible |
|---|---|---|
| Critique | | |
| Élevée | | |
| Moyenne | | |
| Faible / info | | |

---

## 2. Surface exposée constatée (notre Command Post)

Coller les sorties Nmap prises depuis le PC Opérateur (voir `docs/DURCISSEMENT-PI.md` § 5).

```
# nmap-tcp.txt — nmap -sS -p- 192.168.<n>.1
(coller)
```

```
# nmap-udp.txt — nmap -sU -p 53,67,68,69,123,137,161,1900,5353 192.168.<n>.1
(coller)
```

```
# harden.sh <n> --check
(coller la sortie ligne par ligne)
```

**Attendu :** seuls 22/tcp (filtré sauf PC Opérateur), 443/tcp, 8883/tcp, 67/udp et 123/udp répondent. Noter tout écart.

---

## 3. Résultats de la grille défensive

Reprendre la grille D1–D19 de [`PENTEST-PLAN.md`](PENTEST-PLAN.md#volet-défensif--vérifier-notre-command-post-avant-laudit). Une ligne par test.

| # | Test | Résultat attendu | Observé | Verdict | Note |
|---|---|---|---|---|---|
| D1 | Ports TCP exposés | 22, 443, 8883 seulement | | ✅ / ⚠️ / ❌ | |
| D2 | Ports UDP | 67, 123 seulement | | | |
| D3 | Docker ne contourne pas le pare-feu | rien par l'Ethernet | | | |
| D4 | SSH par clé seulement | mot de passe refusé | | | |
| D5 | Pas de port en clair | ni 1883 ni 80 | | | |
| D6 | TLS broker (CA, SAN, ≥1.2) | vérifié par la CA | | | |
| D7 | TLS/HTTPS dashboard | HTTPS seulement | | | |
| D8 | Trafic chiffré (Wireshark) | rien en clair | | | |
| D9 | Broker fermé aux anonymes | refusé | | | |
| D10 | ACL du broker | chaque compte borné | | | |
| D11 | API sans session | `401` | | | |
| D12 | Jeton de service borné au `kind` | refusé | | | |
| D13 | Payload non fiable | ignoré | | | |
| D14 | Limite login 5/min | `429` | | | |
| D15 | Limites commandes/alertes | rejeté au-delà | | | |
| D16 | Inondation MQTT | message >4096 rejeté | | | |
| D17 | Isolation Docker | aucun privilège superflu | | | |
| D18 | Wi-Fi de la table | WPA2, WPS off | | | |
| D19 | Cookie + Origin WebSocket | durci | | | |

---

## 4. Constats détaillés

Un bloc par faille trouvée (chez nous ou chez la cible). Dupliquer autant que nécessaire.

### Constat \<id\> — \<titre court\>

- **Système :** notre Command Post / table G\<cible\>
- **Criticité :** critique / élevée / moyenne / faible
- **Test lié :** D\<n\> ou étape offensive \<n\>
- **Description :** ce qui a été observé, factuellement.
- **Preuve :** commande lancée, sortie, capture d'écran ou de trame (horodatée). Aucun secret en clair conservé.
- **Impact :** ce qu'un attaquant en tirerait.
- **Recommandation :** le correctif.
- **État :** corrigé pendant l'après-midi / à corriger / accepté (justifier).

---

## 5. Audit offensif mené sur la table G\<cible\>

Suivre les six étapes du volet offensif de [`PENTEST-PLAN.md`](PENTEST-PLAN.md#volet-offensif--auditer-une-table-consentante). Pour chacune : ce qui a été tenté, le résultat, et le renvoi vers le constat correspondant en §4.

1. **Reconnaissance (Nmap) :** …
2. **Transport (TLS, Wireshark) :** …
3. **Authentification (broker, API) :** …
4. **Résilience (DoS mesuré, cible prévenue) :** …
5. **MitM (avec accord) :** …
6. **Restitution à la table auditée :** …

---

## 6. Correctifs appliqués

Ce qui a été changé chez nous pendant l'après-midi, avec le commit ou la commande.

| Constat | Correctif | Preuve / commit | Vérifié par |
|---|---|---|---|

---

## 7. Conclusion

Posture finale, points qui restent ouverts et pourquoi, enseignements pour la soutenance.

> Rappel règles d'engagement : cibles consentantes du workshop seulement, aucune donnée détruite, aucun secret conservé. Voir [`PENTEST-PLAN.md`](PENTEST-PLAN.md#règles-dengagement).
