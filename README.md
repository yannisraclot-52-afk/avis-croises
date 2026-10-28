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

1. Répondre aux 30 questions et accepter explicitement le partage du prénom/pseudo et des avis. Une réponse individuelle est téléchargeable à la fin.
2. En mode local, ouvrir l'onglet « Administration » avec le code de démonstration `change-moi`. En mode Supabase, se connecter avec le compte admin créé dans Supabase.
3. Importer les fichiers de réponse reçus, puis consulter le graphique et les comparaisons.

Un participant reçoit un code retour à la fin du questionnaire. En mode local, il ne fonctionne que sur le navigateur où la réponse est conservée. En mode Supabase, le code haché est vérifié par la base et permet de retrouver son profil depuis un autre appareil.

Dans l'administration, les groupes peuvent être renommés. Chaque fiche montre ses membres, sa similarité moyenne interne, ses propositions les plus caractéristiques et la distribution des cinq avis pour chaque question. Une vue transversale classe les propositions qui séparent le plus les groupes. Ces scores sont descriptifs: ils indiquent des tendances dans les réponses et ne démontrent pas de causalité.

La section « Profils individuels » classe aussi les répondants selon le nombre de propositions où leur choix est majoritaire et la popularité moyenne de leurs réponses. « Analyser » ouvre les 30 réponses d'une personne, avec la fréquence du même choix, le statut majoritaire/minoritaire et les réponses sélectionnées le plus souvent ou le plus rarement par les autres.

Le code `change-moi` est uniquement un verrou de démonstration en mode local; il est public dans les fichiers du navigateur et ne protège pas de vraies réponses. En mode Supabase, l'accès admin utilise Supabase Auth et la table `survey_admins`.

## Avant tout déploiement public

### Publier gratuitement l'interface

1. Créer un dépôt GitHub public pour ce projet.
2. Mettre les fichiers de ce dossier à la racine du dépôt (le fichier `index.html` doit être à la racine). Le workflow `.github/workflows/pages.yml` publie automatiquement le site à chaque push sur `main`.
3. Après le premier push, dans GitHub, ouvrir **Settings > Pages** et sélectionner **GitHub Actions** comme source de publication.
4. Attendre la réussite du workflow dans l'onglet **Actions**. L'adresse du site sera `https://yannisraclot-52-afk.github.io/avis-croises/`.

GitHub Pages héberge gratuitement les fichiers du site; Supabase stocke les réponses dans une base partagée. Les noms et les 30 réponses sont lisibles par les visiteurs pour alimenter la carte commune. Le formulaire demande leur accord avant de commencer. Ne demande pas de données sensibles dans ce questionnaire.

### Configurer Supabase gratuitement

1. Crée un projet sur Supabase, puis ouvre son **SQL Editor** et exécute tout le fichier `supabase/schema.sql`.
2. Dans **Project Settings > API**, copie le **Project URL** et la clé **Publishable** (ou `anon` si l’interface affiche encore l’ancien nom) dans `supabaseUrl` et `supabaseAnonKey` de `config.js`. Cette clé est publique; ne mets jamais la clé `service_role` dans le site.
3. Dans **Authentication > Providers**, garde l’inscription publique désactivée. Dans **Authentication > Users**, crée l’utilisateur admin avec son e-mail et son mot de passe. Récupère son UUID, puis ajoute-le dans le SQL Editor :

	```sql
	insert into public.survey_admins (user_id) values ('UUID-DE-TON-UTILISATEUR');
	```

4. Pousse la modification de `config.js` sur GitHub. Après le réglage **Settings > Pages > GitHub Actions**, GitHub publiera le site.

Quand Supabase est configuré, les réponses et noms de groupes sont partagés entre les ordinateurs; le code retour fonctionne partout. Les noms et les réponses sont lisibles par les visiteurs, conformément au consentement du formulaire; l’admin est le seul à pouvoir modifier les noms de groupes. Sans URL et clé Supabase, le site garde le mode local de préparation. Le plan gratuit de Supabase peut mettre un projet en pause après une période d’inactivité; le tableau de bord Supabase permet de le réveiller.