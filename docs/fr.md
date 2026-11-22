# NetBox

Suivez votre inventaire réseau [NetBox](https://netboxlabs.com/oss/netbox/)
dans Gladys : les équipements par statut, les adresses IP et les machines
virtuelles, l'occupation des préfixes de votre choix, les derniers
changements. Une scène peut aussi écrire une entrée de journal sur un
équipement NetBox. Tout reste sur votre réseau local : Gladys parle
directement à votre serveur NetBox.

Testé sur un vrai serveur NetBox 4.7.5 (l'image officielle `netbox-docker`).
Vos retours sont les bienvenus sur le forum de Gladys.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un serveur NetBox, version 3.7 à 4.x, joignable depuis la machine de Gladys.
- Un jeton d'API : dans NetBox, ouvrez le menu de votre profil (en haut à
  droite), **API Tokens**, puis **Add a Token**. NetBox 4.5 et plus créent des
  jetons v2 (`nbt_…`), affichés une seule fois : copiez-le tout de suite. Les
  versions plus anciennes créent des jetons v1 (40 caractères). Les deux
  fonctionnent. Un jeton en lecture seule suffit, sauf pour l'action de scène
  qui écrit des entrées de journal.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Dans **Adresse de NetBox**, saisissez l'adresse que vous ouvrez dans votre
   navigateur, avec son port, par exemple `http://192.168.1.20:8000` ou
   `https://netbox.example.org`.
3. Collez le **jeton d'API**.
4. **Préfixes à suivre** : des préfixes en notation CIDR (`192.168.1.0/24`) ou
   des numéros de préfixe NetBox (le nombre dans l'adresse de la page du
   préfixe), séparés par des virgules, 20 au plus. Un CIDR présent dans
   plusieurs VRF donne un appareil par VRF. Laissez vide pour ne suivre aucun
   préfixe.
5. **Seuil d'alerte d'occupation (%)** : le déclencheur « Préfixe presque
   plein » se déclenche quand un préfixe suivi l'atteint (90 par défaut).
6. **Lire NetBox toutes les** : 5, 15 (par défaut), 30 ou 60 minutes.
7. **Langue des noms de fonctionnalités** règle les noms des fonctionnalités
   (figés à l'ajout d'un appareil) et les textes de l'intégration. Français par
   défaut.
8. Enregistrez, puis lancez **Tester la connexion** : elle affiche la version
   de NetBox, le nombre d'équipements, les préfixes suivis et ceux qui sont
   introuvables.
9. Dans l'onglet **Découverte**, ajoutez l'appareil **NetBox** et les préfixes.

## Appareils

**NetBox** (un appareil pour votre serveur) :

| Fonctionnalité         | Valeur                                                        |
| ---------------------- | ------------------------------------------------------------- |
| NetBox joignable       | 1 quand la dernière lecture a réussi, 0 sinon                 |
| Version de NetBox      | par exemple `4.7.5`                                           |
| Équipements actifs     | équipements au statut « Active »                              |
| Équipements hors ligne | équipements au statut « Offline »                             |
| Équipements en panne   | équipements au statut « Failed »                              |
| Adresses IP            | toutes les adresses IP                                        |
| Machines virtuelles    | toutes les machines virtuelles                                |
| Dernier changement     | action, objet et utilisateur du dernier changement du journal |

**Préfixe …** (un appareil par préfixe suivi) :

| Fonctionnalité    | Valeur                                                     |
| ----------------- | ---------------------------------------------------------- |
| Taux d'occupation | pourcentage, calculé comme la page du préfixe dans NetBox  |
| Adresses libres   | adresses utilisables non utilisées (plafond 4 294 967 296) |

L'occupation suit NetBox : un préfixe compte ses adresses IP et les plages
d'adresses marquées comme utilisées ; un conteneur compte ses préfixes
enfants ; un préfixe marqué comme utilisé est à 100 %. Un préfixe IPv4 plus
court qu'un /31 perd ses adresses de réseau et de diffusion, sauf s'il s'agit
d'un pool.

## Widget du tableau de bord

**NetBox** : quatre tuiles (équipements actifs, équipements hors ligne ou en
panne, adresses IP, machines virtuelles) et une liste, choisie dans les
réglages du widget : les préfixes suivis, du plus plein au moins plein, avec
leur occupation (rouge à partir du seuil, orange 10 points en dessous), les
derniers changements du journal, ou aucune liste. Lecture seule.

## Déclencheurs de scène

- **Préfixe presque plein** : un préfixe suivi atteint le seuil d'occupation.
  De nouveau après être repassé dessous. Filtre : le préfixe (vide : tous).
  Variables : préfixe, VRF, occupation, adresses libres, seuil.
- **Équipement créé ou supprimé** : un équipement est créé ou supprimé dans
  NetBox, vu dans le journal des changements à la lecture suivante. Filtre :
  le changement (création, suppression, vide : les deux). Variables :
  changement, équipement, numéro de l'équipement, utilisateur, heure du
  changement. La première lecture après l'installation est silencieuse : les
  changements passés ne sont pas annoncés. Dix équipements au plus par
  lecture (un import en masse n'inonde pas les scènes). Un préfixe déjà au-dessus du seuil quand il commence
  à être suivi est annoncé dès la première lecture.

Ce qui a été annoncé est enregistré dans le volume de données de
l'intégration : un redémarrage n'annonce rien deux fois. Une nouvelle adresse
de NetBox repart d'une nouvelle base.

## Action de scène

**Ajouter une entrée de journal NetBox** : écrit une entrée de journal sur un
équipement NetBox, désigné par son nom (sans tenir compte des majuscules) ou
son numéro. Type : info (par défaut), succès, avertissement ou danger. Le
texte accepte les variables de scène, par exemple « Onduleur sur batterie :
{{…}} ». Résultats : le numéro de l'entrée et le nom de l'équipement. Il faut
un jeton autorisé en écriture (dans NetBox 4, la case « Write enabled » du
jeton, et le droit d'ajouter des entrées de journal). Un échec (équipement
introuvable, plusieurs équipements de ce nom, jeton non autorisé) s'affiche en
rouge.

## Limites

- NetBox est lu à intervalle régulier, pas en temps réel : un changement
  apparaît à la lecture suivante.
- Une lecture coûte une dizaine de petites requêtes, plus deux ou trois par
  préfixe suivi. NetBox n'impose pas de quota, mais gardez un intervalle
  raisonnable sur un serveur chargé.
- L'occupation additionne les adresses IP et les plages utilisées ; NetBox 4.7
  ne compte qu'une fois une adresse présente dans les deux. Un écart n'est
  possible que si une adresse IP est déclarée dans une plage marquée comme
  utilisée.
- Testé sur NetBox 4.7.5. NetBox 3.7 à 4.6 utilisent la même API (le journal
  des changements se lit sur `/api/extras/object-changes/` avant la 4.1) : non
  testé sur un vrai serveur, vos retours sont les bienvenus.

## Dépannage

- **Jeton refusé** : le jeton est faux, expiré, ou un jeton v2 a été collé sans
  son préfixe `nbt_`. Créez-en un nouveau.
- **Ce jeton ne peut pas lire les équipements ou les adresses IP** : donnez à
  l'utilisateur du jeton le droit de voir les équipements, les adresses IP et
  les préfixes.
- **NetBox ne répond pas** : vérifiez l'adresse et le port depuis la machine de
  Gladys, et que NetBox est démarré.
- **Un préfixe manque** : « Tester la connexion » liste les préfixes
  introuvables ; vérifiez le CIDR ou utilisez le numéro du préfixe.
- Journaux : l'onglet **Journaux** de l'intégration. Réglez `LOG_LEVEL=debug`
  pour voir chaque lecture.
