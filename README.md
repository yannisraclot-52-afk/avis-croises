# Avis croisés

Prototype autonome d'un questionnaire de 30 personnes avec cinq choix de réponse, un ordre aléatoire différent pour chaque répondant et une vue d'analyse réservée à l'administration.

## Démarrer en local

Depuis ce dossier, lancer un serveur statique, par exemple :

```powershell
py -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Remplacer les propositions

Les 30 noms de `propositions.js` sont la liste canonique des propositions. L'ordre des questions est mélangé indépendamment pour chaque répondant, mais les réponses sont enregistrées par nom pour garder les comparaisons correctes.

## Tester le transfert de résultats

1. Répondre aux 30 questions. Une réponse individuelle est téléchargeable à la fin.
2. Ouvrir l'onglet « Administration » et utiliser le code de démonstration `change-moi`.
3. Importer les fichiers de réponse reçus, puis consulter le graphique et les comparaisons.

Un participant reçoit un code retour à la fin du questionnaire. Il peut le saisir sur l'écran d'accueil après avoir quitté le site pour retrouver son profil sur le navigateur où il a répondu. Cette version ne peut comparer que les réponses locales ou celles importées par l'administration sur cet appareil; le code ne permet pas de rapatrier la réponse sur un autre appareil.

Dans l'administration, les groupes peuvent être renommés. Chaque fiche montre ses membres, sa similarité moyenne interne, ses propositions les plus caractéristiques et la distribution des cinq avis pour chaque question. Une vue transversale classe les propositions qui séparent le plus les groupes. Ces scores sont descriptifs: ils indiquent des tendances dans les réponses et ne démontrent pas de causalité.

La section « Profils individuels » classe aussi les répondants selon le nombre de propositions où leur choix est majoritaire et la popularité moyenne de leurs réponses. « Analyser » ouvre les 30 réponses d'une personne, avec la fréquence du même choix, le statut majoritaire/minoritaire et les réponses sélectionnées le plus souvent ou le plus rarement par les autres.

Le code administrateur est défini dans `config.js`. Ce verrou est uniquement une facilité pour tester l'interface : le code est public dans les fichiers du navigateur.

## Avant tout déploiement public

### Publier gratuitement l'interface

1. Créer un dépôt GitHub public pour ce projet.
2. Mettre les fichiers de ce dossier à la racine du dépôt (le fichier `index.html` doit être à la racine). Le workflow `.github/workflows/pages.yml` publie automatiquement le site à chaque push sur `main`.
3. Après le premier push, dans GitHub, ouvrir **Settings > Pages** et sélectionner **GitHub Actions** comme source de publication.
4. Attendre la réussite du workflow dans l'onglet **Actions**. L'adresse du site sera `https://yannisraclot-52-afk.github.io/avis-croises/`.

GitHub Pages héberge gratuitement les fichiers du site, mais ne collecte pas les réponses. Pour que les visiteurs puissent répondre depuis leurs appareils et revenir plus tard voir des résultats actualisés, il faudra ajouter une base distante et une identification fiable. Une combinaison gratuite pour démarrer est GitHub Pages pour le site et Supabase pour la base; le nom seul ne suffit pas à protéger l'accès d'un participant. Le code admin actuel est public et ne doit pas servir à protéger de vraies réponses.