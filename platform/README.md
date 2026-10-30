# Learn LSF — prototype de plateforme LSF

Prototype front-end autonome en HTML, CSS et JavaScript. Il permet d’ajouter des photos ou des vidéos de référence, de les organiser dans une bibliothèque et de suivre une première progression d’apprentissage.

## Lancer en local

Depuis la racine du dépôt :

```bash
cd platform
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000> dans le navigateur. Pour arrêter le serveur, revenir au terminal et faire `Ctrl+C`.

## Ce que contient cette première version

- Ajout d’une référence (photo ou vidéo, jusqu’à 100 Mo) avec son nom et son thème.
- Bibliothèque consultable, filtrable et modifiable (suppression).
- Page de pratique en deux panneaux : regarder la référence et se voir avec la webcam en même temps.
- Progression locale : un signe marqué comme appris rapporte 10 XP.
- Petit défi quotidien de trois pratiques, avec choix aléatoire d’un signe et animation de réussite.
- Page de pratique avec lecture de la référence et aperçu webcam côte à côte.
- Fichiers et progression enregistrés dans le navigateur de l’utilisateur avec IndexedDB et `localStorage`.

## Limites actuelles

- Les médias et la progression restent dans le navigateur et sur l’appareil courant ; il n’y a ni compte ni serveur.
- Aucun modèle ne vérifie le signe : l’utilisateur valide lui-même sa pratique.
- Le prototype ne fournit pas de vidéos LSF préchargées. Il faut ajouter ses propres références.

En ouvrant **Pratiquer** (ou **Commencer** depuis une carte), le site charge le premier signe non appris et demande l’autorisation de la webcam. La caméra fonctionne sur `localhost` ou sur un site servi en HTTPS. Le flux vidéo est uniquement affiché dans la page ; il n’est pas envoyé au serveur ni enregistré.

Cette base sert à rendre tangible le parcours d’apprentissage. La prochaine intégration pourra connecter un extracteur MediaPipe et un système de reconnaissance évalué pour la LSF.
