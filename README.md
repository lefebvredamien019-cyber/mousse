# MOUSSE — site public

Site de présentation de MOUSSE pour les commerces de proximité.

## État actuel

La page contient un mode de présentation local et un parcours de test Supabase optionnel pour comptes commerçants, catalogue public, commandes Click & Collect/livraison et notification e-mail au commerce. Le parcours réel reste inactif tant que les réglages Supabase et d’envoi décrits ci-dessous ne sont pas faits. Le code du site est fusionné dans `main` ; la publication Pages et le domaine doivent être vérifiés.

- La recherche interroge l’API publique Recherche d’Entreprises lorsqu’un visiteur lance une recherche. Les résultats décrivent des établissements déclarés et ne garantissent pas qu’ils accueillent du public.
- Sans configuration Supabase, le parcours d’inscription, le catalogue partagé, les commandes serveur et les e-mails restent désactivés ; la page fonctionne en démonstration locale.
- Avec Supabase et Resend configurés, un compte propriétaire par commerce peut gérer sa boutique et ses produits ; les clients peuvent voir les boutiques publiées et passer une commande sans paiement. Une notification de nouvelle commande est envoyée au commerçant. Le client choisit un e-mail ou un SMS pour la confirmation et le suivi des statuts.
- Ce code est un parcours de test, pas une mise en production complète : aucun paiement, confirmation client par SMS sans compte Twilio, règle géographique de livraison ni rôle personnel/admin n’est fourni. Le statut, l’annulation avec restauration du stock, le suivi d’expédition et les alertes client sont préparés, mais doivent être testés. Prévoir protections anti-robot, règles d’exploitation et informations légales avant ouverture publique.
- La page Contact fournit l’adresse de support `dklm.services@gmail.com` sous forme de lien e-mail.

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

L’adresse de support affichée est `dklm.services@gmail.com`. Le propriétaire a confirmé que cette boîte est existante et fonctionnelle. Préparer également les informations de confidentialité et les conditions nécessaires avant de collecter ou traiter les données personnelles en production.

## Configuration du parcours de test Dklm

Cette procédure doit être faite par le propriétaire des comptes concernés. Ne jamais publier de clé `service_role` ou de clé Resend dans `assets/mousse-config.js`.

1. Créer un projet Supabase dédié au test. Dans le SQL Editor, exécuter `supabase/schema.sql`, puis les migrations `supabase/migrations/20261022130000_security_hardening.sql` et `supabase/migrations/20261022140000_public_storefront_orders.sql` dans cet ordre.
2. Dans les paramètres d’authentification Supabase, autoriser l’inscription par e-mail et régler l’URL de retour sur l’URL exacte du site publié. La fiche boutique est créée automatiquement au premier compte.
3. Remplacer les valeurs vides de `assets/mousse-config.js` par l’URL du projet et sa clé publique/anon. Cette clé peut être publique parce que les accès sont limités par RLS ; elle ne doit jamais être la clé service-role.
4. Configurer Resend avec un expéditeur autorisé et son domaine d’envoi. Dans les secrets Supabase, définir `RESEND_API_KEY`, `ORDER_EMAIL_FROM`, `ORDER_RATE_LIMIT_SALT` (secret aléatoire long), `APP_ORIGINS` (origines exactes séparées par des virgules), `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`. Pour activer le choix SMS, créer/configurer un compte Twilio puis ajouter `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et `TWILIO_FROM_NUMBER`. Les SMS sont payants et un compte d’essai peut limiter les numéros destinataires. Déployer `create-order` et `notify-order-status` avec la configuration de `supabase/config.toml`.
5. Déployer le schéma et les fonctions sur le projet de test, puis utiliser l’origine exacte du site dans `APP_ORIGINS`. Créer le compte Dklm avec `dklm.services@gmail.com`, confirmer l’inscription si Supabase le demande, puis se connecter. L’adresse du compte est proposée comme destinataire commerçant ; ajouter au moins un produit puis publier la boutique.
6. Depuis une autre fenêtre ou un autre appareil, ouvrir Click & Collect, choisir Dklm, ajouter un produit et choisir le suivi par e-mail ou SMS. Valider la commande puis vérifier la notification commerçant dans `dklm.services@gmail.com` et la confirmation client dans le canal choisi. Depuis l’espace commerçant, passer la commande en préparation, prête au retrait, expédiée (avec suivi), en livraison, livrée, retirée ou annulée : chaque changement déclenche une alerte au client. En cas d’échec d’envoi, le statut reste enregistré et le commerçant peut relancer l’alerte du même statut.

L’adresse Dklm est une boîte existante et fonctionnelle, utilisée comme destinataire commerçant. L’envoi des e-mails nécessite quand même un expéditeur autorisé chez Resend ; le SMS nécessite les secrets Twilio. Le site ne devient pas un service de commande opérationnel par la seule publication du code : la base, les secrets, le déploiement Edge et les essais réels restent à configurer et vérifier. L’adresse Dklm est le destinataire ; le fournisseur d’envoi et son adresse d’expéditeur sont des réglages séparés.

## Développement

Le site est une page HTML/CSS/JavaScript statique. Ouvrir `index.html` dans un navigateur pour examiner l’interface. Les données de démonstration restent dans le navigateur ; les effacer dans les réglages du navigateur les supprime.
