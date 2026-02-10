# Feature: Google Login Support

## Status
- [x] Planning complete
- [x] Implementation complete

## Description
Add Google OAuth login/signup support to the platform. Users can click a "Continue with Google" button on both Login and Register pages to authenticate via their Google account. The button appears above the email/password form with a visual divider. When signing up via Google, the user's name is automatically extracted from their Google profile.

## Technical Approach

### Files to Modify
- `frontend/src/hooks/useAuth.ts` - Add `signInWithGoogle()` method
- `frontend/src/contexts/AuthContext.tsx` - Expose `signInWithGoogle` in context
- `frontend/src/pages/Login.tsx` - Add Google button above form
- `frontend/src/pages/Register.tsx` - Add Google button above form

### Files to Create
- `frontend/src/components/ui/google-button.tsx` - Reusable Google sign-in button component
- `frontend/tests/components/GoogleButton.test.tsx` - Unit tests for Google button

### Key Decisions
- **Button placement**: Above the email/password form with "or" divider, following common UX patterns (Google, GitHub, etc. use this layout)
- **Single component**: Create a reusable `GoogleButton` component used by both pages
- **Redirect flow**: Use `signInWithOAuth` with redirect (not popup) for better mobile compatibility
- **Name extraction**: Google OAuth provides name in `user_metadata.full_name` - the DB trigger may need verification

## Pass Criteria

### Unit Tests
- [x] GoogleButton renders with correct text "Continue with Google"
- [x] GoogleButton shows Google logo/icon
- [x] GoogleButton calls `signInWithGoogle` when clicked
- [x] GoogleButton shows loading state when auth is in progress
- [x] GoogleButton is disabled when `authLoading` is true
- [x] Login page shows Google button above email form
- [x] Register page shows Google button above email form
- [x] Divider with "or" text appears between Google button and form

### E2E Tests
- [x] Login page displays Google button
- [x] Register page displays Google button
- [x] Google button is visible and clickable
- [x] Pages load without JavaScript errors after adding Google button

### Acceptance Criteria
- [x] "Continue with Google" button visible on `/login` page
- [x] "Continue with Google" button visible on `/register` page
- [x] Button appears ABOVE the email/password form
- [x] Visual divider with "or" separates Google button from email form
- [x] Button follows Google branding guidelines (white background, Google colors for logo)
- [x] Button has hover/focus states matching existing UI
- [x] Clicking button initiates Google OAuth flow (redirects to Google)
- [x] After successful Google auth, user is redirected to `/surveys`
- [x] New Google users have their name populated from Google profile
- [x] Existing email users who try Google with same email - handled by Supabase (account linking if enabled)

## Implementation Notes

### For the Implementing Agent

1. **Start with the useAuth hook** - Add `signInWithGoogle`:
```typescript
const signInWithGoogle = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/surveys`
    }
  })
  return { error }
}
```

2. **Create GoogleButton component** with:
   - Google "G" logo (use inline SVG for the official Google logo)
   - White background with border (Google branding)
   - Loading spinner when in progress
   - Accessible button with proper aria labels

3. **Add to Login/Register pages**:
   - Place GoogleButton inside CardContent, before the error message
   - Add divider: `<div className="relative"><div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or</span></div></div>`

4. **Verify name handling**: Check what field Google OAuth puts the name in (`full_name`, `name`, or `given_name`). The existing DB trigger uses `raw_user_meta_data->>'name'`. If Google uses a different field, either:
   - Update the trigger to check multiple fields: `COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name')`
   - Or just use what Supabase provides (test first!)

### Reference Patterns
- Existing auth methods in: `frontend/src/hooks/useAuth.ts`
- Button styling: `frontend/src/components/ui/button.tsx`
- Card layout: `frontend/src/pages/Login.tsx` lines 70-100
- Test mocking: `frontend/tests/pages/Login.test.tsx`

### Google Branding
The button should follow Google's branding guidelines:
- White (#FFFFFF) background
- Dark text (#1F1F1F or similar)
- Google "G" logo in full color (official SVG)
- Border: `border border-input`
- Rounded corners matching existing buttons

### Google Logo SVG
Use this official Google "G" logo:
```tsx
<svg viewBox="0 0 24 24" width="18" height="18">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
</svg>
```

### Test Setup
- Mock `signInWithGoogle` in unit tests to avoid actual OAuth redirects
- For E2E, just verify button presence and clickability (actual OAuth flow requires real credentials)
- Update existing Login/Register tests to include Google button assertions

### Test Data
- Mock user object: `{ id: 'test-user-id', email: 'test@example.com' }`
- Add `signInWithGoogle: vi.fn()` to mock auth context

## Out of Scope
- Other OAuth providers (GitHub, Apple, etc.) - future feature
- Account linking UI (letting users manually link Google to existing account)
- "Remember me" or session duration settings
- Custom OAuth scopes beyond basic profile
- Popup mode for OAuth (using redirect only)

## Related Files
```
frontend/src/
├── contexts/AuthContext.tsx      # Add signInWithGoogle to context
├── hooks/useAuth.ts              # Add signInWithGoogle method
├── components/ui/
│   └── google-button.tsx         # NEW: Google sign-in button
└── pages/
    ├── Login.tsx                 # Add GoogleButton + divider
    └── Register.tsx              # Add GoogleButton + divider
```
