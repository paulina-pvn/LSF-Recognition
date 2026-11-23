# Learn LSF — prototype de plateforme LSF

Learn LSF est une plateforme locale avec un serveur Python. Sa bibliothèque rassemble les signes présents dans les vidéos locales du projet DTW et les médias personnels ajoutés dans le navigateur.

## Aperçu sans le reconnaisseur

Depuis la racine du dépôt :

```bash
cd platform
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000> dans le navigateur. Pour arrêter le serveur, revenir au terminal et faire `Ctrl+C`.

## Fonctions

- Ajout d’une référence (photo ou vidéo, jusqu’à 100 Mo) avec son nom et son thème.
- Bibliothèque consultable, filtrable et modifiable (suppression).
- Page de pratique en deux panneaux : regarder la référence et se voir avec la webcam en même temps.
- Progression locale : un signe noté **Réussi** rapporte 10 XP la première fois.
- Révision espacée : **Réussi** repropose le signe après 15 pratiques classées ; **Raté** le repropose après 2 autres pratiques.
- Petit défi quotidien de trois pratiques, avec choix aléatoire d’un signe et animation de réussite.
- Page de pratique avec lecture de la référence et aperçu webcam côte à côte.
- Fichiers et progression enregistrés dans le navigateur de l’utilisateur avec IndexedDB et `localStorage`.

## Limites actuelles

- Les médias de bibliothèque, le statut des signes et le calendrier de révision restent dans le navigateur et sur l’appareil courant ; il n’y a ni compte ni synchronisation en ligne.
- Le mode statique ci-dessus n’active que l’aperçu caméra et les médias déjà enregistrés dans le navigateur. Pour utiliser les signes DTW et la reconnaissance, lance le serveur intégré indiqué ci-dessous.

En ouvrant **Pratiquer** (ou **Commencer** depuis une carte), le site charge le premier signe non appris et demande l’autorisation de la webcam. La caméra fonctionne sur `localhost` ou sur un site servi en HTTPS.

## Lancer avec la reconnaissance DTW

La page **Ma bibliothèque** affiche les classes du jeu de vidéos qui se trouve dans Sign-Language-Recognition--MediaPipe-DTW/data/videos/. Elle lit une vidéo d’exemple par classe et indique combien de références vidéo existent pour ce signe. Les signes et vidéos intégrés sont servis depuis le disque local.

Une vidéo ajoutée par l’utilisateur est enregistrée dans le navigateur et copiée dans Sign-Language-Recognition--MediaPipe-DTW/data/videos/user_uploads/, puis ses points MediaPipe sont extraits pour que le DTW puisse la comparer. Les anciennes vidéos déjà présentes dans la bibliothèque sont également ajoutées au reconnaisseur au premier essai. Ces fichiers ne sont pas envoyés sur GitHub : ils restent sur cet ordinateur. Une photo reste un support visuel uniquement. Les vidéos devraient être courtes et ne contenir qu’un seul signe. Une seule vidéo personnelle peut servir de référence de départ ; ajoute plusieurs prises pour rendre la reconnaissance moins sensible à une seule façon de signer.

Pendant la pratique, le navigateur MediaPipe Tasks affiche les points et connexions des deux mains sur l’aperçu webcam en direct. Le runtime WebAssembly est chargé depuis jsDelivr (connexion Internet requise au premier chargement) ; le modèle de détection est servi par le serveur local. En parallèle, le site envoie l’essai au serveur local DTW et affiche le signe prédit. L’essai est temporaire et supprimé après analyse. Le navigateur et le serveur doivent rester sur le même ordinateur pour cette version.

Depuis la racine du dépôt :

```bash
cd Sign-Language-Recognition--MediaPipe-DTW
source .venv/bin/activate
python -m pip install -r ../platform/requirements.txt
python ../platform/server.py
```

Ouvre ensuite <http://localhost:8000>. Au démarrage, le serveur charge les vidéos et les caches DTW. La toute première préparation peut prendre du temps si les caches de `data/dataset_tasks/` ne sont pas encore créés. Garde les vidéos locales dans `Sign-Language-Recognition--MediaPipe-DTW/data/videos/` et le modèle `models/hand_landmarker.task` présent. Les médias de référence et ce modèle sont ignorés par Git ; il faut donc les télécharger/importer sur un autre ordinateur aussi.

Dans la page **Pratiquer** : active la caméra, clique **Enregistrer mon essai**, fais le signe, puis clique **Arrêter et analyser**. La reconnaissance compare avec les vidéos du dataset DTW et les vidéos personnelles importées. Elle compare les coûts DTW normalisés et combine les meilleures références de chaque signe, ce qui réduit l’avantage des classes qui ont plus de vidéos. Le signe est marqué appris si la prédiction correspond au signe pratiqué. Le site peut encore se tromper : le modèle ne compare que la forme et le mouvement des mains, pas leur position par rapport au visage ou au corps.
