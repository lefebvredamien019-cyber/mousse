# MOUSSE — Ambiance sonore de l’espace commerçant

## Objectif
Ajouter un lecteur d’ambiance discret dans l’espace commerçant de MOUSSE. Il ne doit jamais apparaître dans l’espace client ni modifier la caisse, les commandes, les vitrines, l’authentification ou les données commerciales existantes.

## Expérience attendue
- Lecteur compact et discret, cohérent avec l’identité visuelle MOUSSE (vert forêt, crème, interface calme).
- Bibliothèque de catégories : Zen & détente, Lounge & chill, Nature (pluie/eau/forêt), Ambiance dynamique.
- Un commerçant peut choisir une ambiance, lancer/mettre en pause, arrêter, régler le volume et désactiver totalement le son.
- Lecture continue en boucle, sans blanc volontaire entre deux répétitions lorsque le fichier source le permet.
- Restaurer le dernier choix et le volume du commerçant lors de sa prochaine session.
- État initial silencieux : aucun son ne doit démarrer avant une action explicite de l’utilisateur, conformément aux politiques d’autoplay des navigateurs.
- Après autorisation par clic, conserver la lecture lors de la navigation interne dans l’espace commerçant, sans créer plusieurs lecteurs audio.
- À la fermeture de session ou à la sortie de l’espace commerçant, arrêter la lecture. Ne jamais jouer dans l’espace client.

## Règles techniques
1. Avant toute intégration, repérer les points d’entrée réels de l’espace commerçant dans `index.html` et le cycle d’initialisation de `assets/mousse-live.js`.
2. Créer un composant/contrôleur audio isolé (un seul élément audio partagé) ; ne pas dupliquer le lecteur à chaque changement de vue.
3. Utiliser uniquement des fichiers audio fournis par MOUSSE avec licence autorisant explicitement l’intégration et la diffusion dans un logiciel commercial. Ne pas récupérer de musique protégée depuis YouTube, Spotify ou des sources non autorisées.
4. Prévoir des fichiers optimisés (formats largement pris en charge, taille raisonnable) et un manifeste de bibliothèque facile à enrichir.
5. Gérer les erreurs de chargement, réseau, format non pris en charge et refus d’autoplay avec un message discret et une commande de lancement manuel.
6. Le volume doit être borné entre 0 et 1 ; le bouton muet doit être distinct de pause/arrêt.
7. Respecter l’accessibilité : libellés explicites, commandes utilisables au clavier, focus visible, état lecture/pause annoncé.
8. Ne pas envoyer de données audio à Supabase. Ne stocker aucune préférence avant d’avoir identifié le mécanisme de profil et les règles RLS existants.

## Persistance des préférences
- Préférences attendues : identifiant de l’ambiance, volume, mode muet.
- Priorité : mécanisme de préférences déjà existant dans MOUSSE, isolé par utilisateur/commerçant.
- Si aucun mécanisme adapté n’existe, proposer d’abord une solution locale non sensible et documenter sa limite multi-appareils. Ne pas créer de table Supabase ni de migration sans vérifier le schéma, les politiques RLS et obtenir validation.
- Une préférence locale ne doit jamais être présentée comme synchronisée entre appareils.

## Limites et licences
La fonctionnalité technique peut être développée sans fournir de morceaux commerciaux. Les pistes audio finales doivent être originales ou provenir d’une bibliothèque dont la licence autorise explicitement l’usage commercial et la diffusion aux clients du commerçant. Conserver les justificatifs de licence et les conditions d’attribution, le cas échéant.

## Hors périmètre
- Pas de diffusion dans l’espace client.
- Pas de lecture automatique avant le premier geste utilisateur.
- Pas d’import de fichiers personnels dans cette première version.
- Pas de service de streaming, de compte musical tiers ou de reconnaissance musicale.
- Aucune modification de la caisse MOUSSE, des stocks, ventes, commandes, paiements ou du schéma Supabase.

## Plan d’implémentation
1. Cartographier les vues et scripts existants ; confirmer exactement où commence et se termine l’espace commerçant.
2. Valider une maquette du lecteur (position, taille, commandes, choix d’ambiance) avant de toucher au code fonctionnel.
3. Ajouter le contrôleur audio isolé et son interface, uniquement dans l’espace commerçant.
4. Brancher les préférences sur le mécanisme de persistance déjà validé, ou rester en local si aucune solution sûre n’existe.
5. Ajouter uniquement des pistes dont les licences sont vérifiées.
6. Tester sur Chrome Android, Chrome ordinateur et Safari si pris en charge : premier clic, boucle, pause, arrêt, volume, muet, navigation interne, déconnexion, changement d’utilisateur, réseau indisponible.
7. Vérifier que l’espace client reste silencieux et que les fonctions commerciales existantes n’ont pas régressé.

## Critères d’acceptation
- Aucun son avant clic explicite.
- Une seule lecture audio active à la fois.
- La piste sélectionnée boucle jusqu’à pause/arrêt ou sortie de l’espace commerçant.
- Le volume et le mode muet fonctionnent correctement.
- Les préférences ne fuient jamais entre deux commerçants.
- Aucun changement dans les parcours client, commande, paiement, caisse ou données existantes.
- Les erreurs sont gérées sans bloquer l’application.
- Les tests de non-régression sont documentés.

## État
Cahier technique préparatoire uniquement. Aucun code applicatif, fichier audio, schéma de base de données ou réglage de production n’a été modifié.
