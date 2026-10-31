-- Task 14: allow PDF scans/receipts alongside images in uk-expense-receipts.
-- Opening expenses remain receipt-optional (IS-6a / Task 13). No finance math change.

update storage.buckets
set
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'application/pdf'
  ]
where id = 'uk-expense-receipts';
