# MOUSSE — site public

Site de présentation de MOUSSE et point d’entrée vers les boutiques locales, le Click & Collect et la livraison.

## État du projet

- Le site statique est publié par GitHub Pages. La dernière exécution **pages build and deployment** s’est terminée avec succès le 22 octobre 2026.
- Le dépôt contient le domaine souhaité `www.mousse-market.fr`, mais la résolution DNS, le domaine personnalisé dans GitHub Pages et le certificat HTTPS n’ont pas pu être vérifiés. Ne pas considérer le domaine personnalisé comme confirmé tant qu’il n’est pas ouvert et contrôlé dans un navigateur.
- Le projet Supabase de test est actif (région `eu-west-1`). Le schéma, les règles d’accès et les migrations de commande et de notification sont installés. Les fonctions Edge `create-order` et `notify-order-status` sont déployées.
- Le site possède sa configuration publique Supabase. Elle ne contient pas de clé secrète.
- Le parcours de boutique et de commande est préparé, mais il n’a pas encore été validé de bout en bout : aucun commerce ni produit de test n’est actuellement enregistré dans la base et les secrets du service d’e-mail ne sont pas encore configurés.

## Ce que le parcours prévoit

Un commerçant peut créer un compte, compléter sa boutique, ajouter des produits et la publier. Un client peut consulter les boutiques publiées, choisir le retrait ou la livraison si le commerce l’a activée, passer une commande sans paiement et choisir le suivi par e-mail ou SMS. Le commerçant peut faire évoluer le statut d’une commande et envoyer une notification au client.

Les notifications ne sont réellement envoyées qu’une fois le fournisseur et ses secrets configurés. L’adresse du commerce `dklm.services@gmail.com` est l’adresse de réception de test confirmée par le propriétaire ; elle ne remplace pas une adresse d’expéditeur vérifiée chez le fournisseur d’e-mail.

À ce stade, MOUSSE n’intègre pas de paiement. Le modèle d’accès installé couvre un compte propriétaire par commerce ; il ne fournit pas encore de rôles distincts pour le personnel ou l’administration MOUSSE. Les règles de livraison, les obligations légales, la protection anti-robot et les essais opérationnels doivent aussi être définis avant une ouverture commerciale plus large.

## Mise en service du test Dklm

Les secrets doivent être saisis directement dans le tableau de bord du fournisseur, jamais dans le dépôt GitHub, le navigateur ou un message.

1. **Régler l’authentification Supabase.** Dans le tableau de bord du projet `bdnhkkccaylwvlpmkcwz`, activer l’inscription par e-mail. Régler l’URL du site et les URL de redirection autorisées pour le domaine réellement utilisé. Ajouter aussi l’URL GitHub Pages si elle sert aux essais. Les valeurs doivent correspondre exactement aux adresses utilisées par le navigateur.
2. **Autoriser l’envoi d’e-mails.** Créer/configurer un compte Resend, vérifier son domaine d’envoi et choisir un expéditeur autorisé. Dans les secrets des fonctions Edge Supabase, définir `RESEND_API_KEY`, `ORDER_EMAIL_FROM` (l’adresse d’expédition vérifiée) et `ORDER_RATE_LIMIT_SALT` (valeur aléatoire longue). Les deux origines du site prévues pour les tests sont autorisées par défaut dans le code des fonctions ; `APP_ORIGINS` peut servir à remplacer cette liste.
3. **Activer les SMS seulement si souhaité.** Créer/configurer un compte Twilio puis définir `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et `TWILIO_FROM_NUMBER`. L’envoi de SMS est payant et les comptes d’essai peuvent limiter les destinataires.
4. **Créer la boutique de test.** Sur le site publié, s’inscrire avec `dklm.services@gmail.com`, confirmer l’adresse si demandé, se connecter, compléter la boutique Dklm, ajouter au moins un produit et publier la boutique.
5. **Faire un vrai essai client.** Depuis une autre fenêtre ou un autre appareil, ouvrir la vitrine, sélectionner Dklm, ajouter un produit, renseigner les coordonnées du client, choisir retrait ou livraison et le mode de notification, puis envoyer la commande. Vérifier la commande et l’e-mail reçu par Dklm. Faire ensuite évoluer le statut et vérifier le message client. Pour tester le SMS, utiliser un numéro autorisé par Twilio.
6. **Contrôler les réglages de production.** Vérifier les DNS et HTTPS du domaine, les informations légales et de confidentialité, les parcours d’erreur, les stocks et les consignes de préparation/livraison avant d’inviter de vrais clients.

Si Resend n’est pas configuré, la commande ne peut pas être confirmée par les e-mails prévus. Si Twilio n’est pas configuré, le client ne doit pas choisir le suivi par SMS. Aucun paiement n’est prélevé par le parcours actuel.

## Domaine personnalisé

Le fichier `CNAME` déclare `www.mousse-market.fr` comme domaine souhaité. Il faut encore vérifier la section **Pages** des paramètres GitHub, configurer les enregistrements DNS demandés par GitHub auprès du fournisseur du domaine, attendre leur propagation, puis contrôler que le site s’ouvre en HTTPS et que le certificat est valide. Le fichier `CNAME` seul ne prouve pas que ces étapes sont terminées.

## Développement

Le site public est une page HTML/CSS/JavaScript statique. Ouvrir `index.html` dans un navigateur pour examiner l’interface. Les données de démonstration locale restent dans le navigateur ; les effacer dans les réglages du navigateur les supprime. Les commandes partagées et les comptes de test sont enregistrés dans le projet Supabase configuré.
