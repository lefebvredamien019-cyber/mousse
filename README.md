# MOUSSE — site public

Site de présentation de MOUSSE pour les commerces de proximité.

## État actuel

La page publique est une interface de présentation interactive. Elle ne constitue pas encore un service de production pour les commerçants.

- La recherche interroge l’API publique Recherche d’Entreprises lorsqu’un visiteur lance une recherche. Les résultats décrivent des établissements déclarés et ne garantissent pas qu’ils accueillent du public.
- Les parcours d’affluence, de Click & Collect, de gestion d’un commerce et de demande de gestion d’une fiche sont des démonstrations. Les profils, produits, commandes, demandes et préférences de présentation sont conservés dans le stockage local du navigateur utilisé.
- Ces données ne sont pas partagées entre visiteurs ou appareils. Il n’y a pas encore d’authentification, de base de données MOUSSE, de traitement de commande, de paiement, ni d’envoi de demande ou de notification par e-mail.
- Le site ne doit donc pas être présenté comme un service de commande ou un espace commerçant prêt pour une utilisation réelle.
- La page Contact indique que l’adresse de support reste à confirmer. Remplacer ce texte par l’adresse approuvée dans `index.html` quand elle sera disponible ; aucune adresse n’est configurée pour l’instant.

## Avant de publier sous www.mousse-market.fr

Le dépôt contient le fichier `CNAME` avec `www.mousse-market.fr`. Cela déclare le domaine souhaité pour GitHub Pages, mais ne confirme ni le paramétrage Pages, ni la résolution DNS, ni la disponibilité du site en HTTPS.

1. Dans les paramètres GitHub du dépôt, ouvrir **Pages** et vérifier qu’une source de publication est configurée et que `www.mousse-market.fr` est reconnu comme domaine personnalisé.
2. Chez le fournisseur DNS du domaine, créer l’enregistrement **CNAME** pour l’hôte `www` vers la cible GitHub Pages affichée dans les paramètres du dépôt. Suivre les valeurs affichées par GitHub pour toute autre entrée DNS nécessaire ; ne pas remplacer les enregistrements existants sans les vérifier.
3. Attendre la propagation DNS, puis vérifier le domaine dans GitHub Pages, activer **Enforce HTTPS** lorsque l’option devient disponible et tester `https://www.mousse-market.fr`.
4. Confirmer que le domaine reste attaché au bon dépôt et que le certificat HTTPS est valide après publication.

La configuration DNS et GitHub Pages n’a pas été vérifiée pendant cette modification. Le domaine n’est donc pas déclaré en ligne.

## À construire avant l’usage réel

### Authentification et rôles

Choisir un fournisseur d’authentification et créer des comptes individuels. Prévoir au minimum :

- **Commerçant propriétaire** : accès à son commerce, son profil, son catalogue et ses commandes.
- **Personnel du commerce** : accès limité au commerce auquel il est rattaché, selon les permissions accordées.
- **Administration MOUSSE** : accès de support et de modération contrôlé, avec journalisation.

L’interface seule ne peut pas faire respecter ces rôles. Chaque accès doit être validé côté serveur, et chaque commerce doit être isolé des autres. Une demande de gestion de fiche doit vérifier l’identité et le droit de représentation avant d’accorder un accès.

### Base de données et services serveur

Mettre en place une base de données et un backend avant de remplacer le stockage local. Définir les données et règles d’accès pour les comptes, commerces, fiches revendiquées, produits, stocks, horaires, commandes et statuts. Appliquer des contrôles d’accès par commerce côté serveur (par exemple, des politiques de lignes si le service retenu les prend en charge). Ne jamais exposer de clé secrète dans le code public.

Les commandes nécessitent aussi un traitement serveur fiable, la gestion des stocks et des notifications. Aucun paiement n’est actuellement intégré. L’intégration d’un prestataire de paiement, la livraison et les consignes sécurisées doivent être conçues et validées séparément avant toute promesse aux clients.

### Contact et informations de service

Confirmer l’adresse de support, puis remplacer le message « Adresse à configurer » dans la page Contact et faire vérifier son fonctionnement. Préparer également les informations de confidentialité et les conditions nécessaires avant de collecter ou traiter les données personnelles en production.

## Développement

Le site est une page HTML/CSS/JavaScript statique. Ouvrir `index.html` dans un navigateur pour examiner l’interface. Les données de démonstration restent dans le navigateur ; les effacer dans les réglages du navigateur les supprime.
