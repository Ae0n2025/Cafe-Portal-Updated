# Café Portal

Café Portal is a student project for STI College Global City. The single-page app combines customer login, the customer portal, and the staff workspace.

## Run the app

Serve `index.html` from a local web server (for example, VS Code Live Server). The app uses Supabase email/password authentication and reads the project URL and publishable key from `app.js`. The publishable key is intended for browser use; never add a database password or secret key to frontend code.

## Supabase setup

1. Run the entire `supabase-schema.sql` file in the Supabase SQL Editor.
2. Enable the Email provider in Supabase Authentication settings.
3. Configure the Supabase Site URL and allowed redirect URLs for the host serving `index.html`.
4. Create staff users in Supabase Authentication, then add each approved user's UUID to `public.staff_members` from the SQL Editor:

   ```sql
   insert into public.staff_members (user_id)
   values ('<auth-user-uuid>');
   ```

Customer accounts can be created from the sign-in screen. Staff accounts cannot self-authorize; only users listed in `staff_members` can enter the staff workspace.

The PostgreSQL connection string is for trusted database tools only. The browser app uses the Supabase API and publishable key, not a direct PostgreSQL connection.

The Edge Function in `supabase/functions/customer-profile` is a separate optional server endpoint; the single-page app reads customer profiles directly through Supabase with row-level security.
