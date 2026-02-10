# Feature: UI Overhaul - Claude-Inspired Design System

## Status
- [x] Planning complete
- [ ] Ready for implementation

## Description
Complete visual redesign of Virtual Personas Arena to achieve a high-class, professional aesthetic inspired by Claude's design language. This includes warm color palette, sidebar navigation, refined typography, and polished components across all 9 pages.

## Design Reference: Claude's Aesthetic

### Core Principles
- **Warm & Approachable**: Cream/beige tones instead of stark white, warm grays instead of cool
- **Generous Whitespace**: Content breathes, nothing cramped
- **Subtle Depth**: Light borders and shadows, not heavy drop shadows
- **Soft Corners**: Rounded-xl/2xl for approachable feel
- **Purposeful Color**: Accent color used sparingly for emphasis

---

## Technical Approach

### Design Tokens (CSS Variables)

#### Light Mode Palette
```css
--background: 40 30% 98%;        /* Warm cream */
--foreground: 30 10% 15%;        /* Warm charcoal */
--card: 40 25% 96%;              /* Slightly darker cream */
--card-foreground: 30 10% 15%;
--primary: 24 80% 55%;           /* Warm orange/terracotta */
--primary-foreground: 0 0% 100%;
--secondary: 35 20% 92%;         /* Warm beige */
--secondary-foreground: 30 10% 25%;
--muted: 35 15% 90%;             /* Muted beige */
--muted-foreground: 30 8% 45%;
--accent: 24 80% 55%;            /* Same as primary */
--accent-foreground: 0 0% 100%;
--destructive: 0 70% 55%;        /* Warm red */
--border: 35 15% 88%;            /* Subtle warm border */
--input: 35 15% 88%;
--ring: 24 80% 55%;
```

#### Dark Mode Palette
```css
--background: 30 10% 10%;        /* Warm dark gray, not pure black */
--foreground: 40 20% 95%;        /* Warm off-white */
--card: 30 10% 13%;              /* Slightly lighter dark */
--card-foreground: 40 20% 95%;
--primary: 24 85% 60%;           /* Brighter orange for dark mode */
--primary-foreground: 30 10% 10%;
--secondary: 30 10% 18%;         /* Warm dark secondary */
--secondary-foreground: 40 15% 85%;
--muted: 30 8% 20%;
--muted-foreground: 35 10% 60%;
--accent: 24 85% 60%;
--accent-foreground: 30 10% 10%;
--destructive: 0 65% 55%;
--border: 30 8% 22%;
--input: 30 8% 22%;
--ring: 24 85% 60%;
```

#### Typography
```css
--font-sans: 'Inter', system-ui, sans-serif;
--font-heading: 'Inter', system-ui, sans-serif;  /* Or consider 'Geist' */
```

#### Spacing & Radius
```css
--radius: 0.75rem;               /* Base radius (rounded-xl feel) */
--radius-sm: 0.5rem;
--radius-lg: 1rem;
--radius-xl: 1.5rem;
```

#### Shadows (Light Mode)
```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.03);
--shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.05), 0 4px 6px -4px rgb(0 0 0 / 0.05);
```

---

### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/layout/Sidebar.tsx` | New sidebar navigation component |
| `frontend/src/components/layout/SidebarLayout.tsx` | Layout wrapper with sidebar |
| `frontend/src/components/ui/theme-toggle.tsx` | Light/dark mode toggle |
| `frontend/tests/ui/theme.test.tsx` | Theme switching tests |
| `frontend/tests/ui/sidebar.test.tsx` | Sidebar navigation tests |
| `frontend/tests/e2e/ui-overhaul.spec.ts` | E2E visual regression tests |

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/index.css` | Complete theme variable overhaul |
| `frontend/src/components/layout/Layout.tsx` | Switch to SidebarLayout |
| `frontend/src/components/layout/Navbar.tsx` | Remove or repurpose as mobile header |
| `frontend/src/components/ui/button.tsx` | Updated styling, softer shadows |
| `frontend/src/components/ui/card.tsx` | Warm borders, subtle shadows |
| `frontend/src/components/ui/input.tsx` | Refined focus states, warm borders |
| `frontend/src/components/ui/badge.tsx` | Warm color variants |
| `frontend/src/components/ui/progress.tsx` | Gradient fill, rounded ends |
| `frontend/src/components/ui/dialog.tsx` | Refined backdrop, smooth animation |
| `frontend/src/components/ui/select.tsx` | Warm styling |
| `frontend/src/components/ui/checkbox.tsx` | Warm accent color |
| `frontend/src/components/ui/radio-group.tsx` | Warm accent color |
| `frontend/src/components/ui/tabs.tsx` | Refined active state |
| `frontend/src/components/ui/textarea.tsx` | Match input styling |
| `frontend/src/pages/Home.tsx` | Complete redesign with warm palette |
| `frontend/src/pages/Login.tsx` | Centered card, warm styling |
| `frontend/src/pages/Register.tsx` | Match Login styling |
| `frontend/src/pages/Surveys.tsx` | Card grid with refined styling |
| `frontend/src/pages/SurveyCreate.tsx` | Form refinements |
| `frontend/src/pages/SurveyView.tsx` | Status display improvements |
| `frontend/src/pages/SurveyResults.tsx` | Chart theming, warm colors |
| `frontend/src/pages/Backstories.tsx` | Table/card refinements |
| `frontend/src/pages/Settings.tsx` | Form layout improvements |
| `frontend/index.html` | Add Inter font from Google Fonts |
| `frontend/tailwind.config.js` | Update theme configuration |

---

## Component Specifications

### Sidebar Navigation

```
┌─────────────────────────────────────────────────────────────┐
│ ┌──────────┐                                                │
│ │  Logo    │  Virtual Personas Arena                        │
│ │  Icon    │                                                │
│ └──────────┘                                                │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│   MAIN                                                      │
│   ┌─────────────────────────────────┐                      │
│   │ 🏠  Dashboard                    │  ← Active state     │
│   └─────────────────────────────────┘                      │
│      📋  Surveys                                           │
│      📚  Backstories                                       │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│   ACCOUNT                                                   │
│      ⚙️  Settings                                          │
│      🌙  Dark Mode Toggle                                  │
│                                                             │
│                           ─────────────────────────────────│
│                                                             │
│   ┌─────────────────────────────────┐                      │
│   │ 👤  User Name                   │                      │
│   │     user@email.com              │                      │
│   │                    Sign Out →   │                      │
│   └─────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

**Specifications:**
- Width: 280px (collapsible to 72px on mobile)
- Background: `var(--card)` with subtle border-right
- Active item: `var(--primary)` background with rounded corners
- Hover: Subtle background change
- Section labels: Muted, uppercase, small text
- User section: Bottom of sidebar with avatar, name, email

### Button Component Updates

**Default (Primary):**
- Background: `var(--primary)` (warm orange)
- Hover: Slightly darker, subtle shadow lift
- Active: Pressed effect (slight scale down)
- Transition: `all 150ms ease`
- Border-radius: `var(--radius)` (0.75rem)

**Secondary:**
- Background: `var(--secondary)` (warm beige)
- Border: 1px `var(--border)`
- Hover: Slightly darker background

**Ghost:**
- No background
- Hover: `var(--muted)` background

**Outline:**
- Border: 1px `var(--border)`
- Hover: `var(--muted)` background

### Card Component Updates

- Background: `var(--card)`
- Border: 1px `var(--border)` (subtle)
- Border-radius: `var(--radius-lg)` (1rem)
- Shadow: `var(--shadow)` (very subtle)
- Hover (if interactive): Slight shadow increase, subtle border darken
- Padding: Generous (p-6 default)

### Input Component Updates

- Background: `var(--background)`
- Border: 1px `var(--border)`
- Border-radius: `var(--radius)` (0.75rem)
- Focus: Ring with `var(--ring)` color, 2px offset
- Placeholder: `var(--muted-foreground)`
- Height: 44px for comfortable touch targets

### Progress Component Updates

- Track: `var(--muted)`
- Fill: Gradient from `var(--primary)` to slightly lighter variant
- Border-radius: Full (rounded-full)
- Height: 8px

---

## Page-by-Page Specifications

### 1. Home Page (Landing)
- Hero section with warm gradient background (subtle)
- Feature cards in 2-3 column grid
- Call-to-action buttons with primary color
- Testimonial or info section with cream background

### 2. Login / Register Pages
- Centered card (max-w-md)
- Warm cream background
- Logo at top of card
- Social login options (if applicable) with outlined buttons
- Link between login/register at bottom

### 3. Surveys List Page
- Page header with title + "New Survey" button
- Filter/search bar with warm styling
- Card grid layout (responsive: 1/2/3 columns)
- Each card shows: title, status badge, question count, date
- Empty state with illustration and CTA

### 4. Survey Create/Edit Page
- Two-column layout on desktop (form left, preview right)
- Section cards for: Basic Info, Questions, Demographics, Settings
- Drag-and-drop question reordering
- Warm form styling throughout

### 5. Survey View Page
- Header with survey title, status, actions
- Stats cards (backstory count, completion %, time remaining)
- Progress visualization
- Question preview accordion

### 6. Survey Results Page
- Summary stats at top in card grid
- Charts with warm color palette (oranges, creams, warm grays)
- Data table with warm row hover
- Export options

### 7. Backstories Page
- Table view with warm row styling
- Filters for demographics
- Upload/import actions
- Pagination with warm styling

### 8. Settings Page
- Section cards for: Profile, LLM Configuration, Preferences
- Form inputs with warm styling
- Save buttons aligned right

---

## Pass Criteria

### Unit Tests

#### Theme System
- [ ] Theme toggle switches between light and dark mode
- [ ] Theme preference persists in localStorage
- [ ] CSS variables update correctly on theme change
- [ ] System preference is detected on first load

#### Sidebar Component
- [ ] Sidebar renders with all navigation items
- [ ] Active route is highlighted correctly
- [ ] Sidebar collapses on mobile (< 768px)
- [ ] Navigation links route correctly
- [ ] User info displays email and sign-out button
- [ ] Sign-out triggers auth logout

#### Button Component
- [ ] All variants render correctly (default, secondary, ghost, outline, destructive)
- [ ] Hover states apply correct styles
- [ ] Disabled state prevents interaction and shows correct styling
- [ ] Loading state shows spinner and disables button

#### Card Component
- [ ] Card renders with correct padding and border
- [ ] Interactive cards show hover state
- [ ] Card header, content, footer sections render correctly

#### Input Component
- [ ] Focus state shows correct ring color
- [ ] Error state shows destructive border
- [ ] Disabled state shows muted styling

### E2E Tests

#### Navigation Flow
- [ ] User can navigate between all pages via sidebar
- [ ] Active state updates when route changes
- [ ] Mobile hamburger menu opens/closes sidebar
- [ ] Breadcrumbs show correct path (if implemented)

#### Theme Switching
- [ ] Click theme toggle changes from light to dark
- [ ] Theme persists after page refresh
- [ ] All pages respect theme setting
- [ ] Charts update colors with theme

#### Visual Consistency
- [ ] All pages use consistent color palette
- [ ] Typography hierarchy is consistent across pages
- [ ] Spacing is consistent (no cramped or overly sparse areas)
- [ ] All interactive elements have visible hover/focus states

#### Responsive Design
- [ ] Sidebar collapses to mobile menu below 768px
- [ ] Cards stack vertically on mobile
- [ ] Forms remain usable on mobile
- [ ] No horizontal scroll on any page

### Acceptance Criteria

#### Design System
- [ ] Warm color palette implemented in both light and dark modes
- [ ] Inter font loaded and applied throughout
- [ ] Consistent border-radius (0.75rem default, 1rem for cards)
- [ ] Subtle shadows that don't overpower

#### Navigation
- [ ] Sidebar is fixed on left side (desktop)
- [ ] Sidebar shows logo, main nav, account section, user info
- [ ] Theme toggle is accessible in sidebar
- [ ] Mobile: Hamburger menu with slide-out sidebar

#### Components
- [ ] All shadcn/ui components updated with warm palette
- [ ] Buttons have smooth hover transitions
- [ ] Cards have subtle borders and shadows
- [ ] Inputs have warm focus rings
- [ ] Progress bars have gradient fills

#### Pages
- [ ] All 9 pages updated with new design
- [ ] Consistent page headers with title and actions
- [ ] Forms use consistent layout patterns
- [ ] Empty states are styled warmly

#### Accessibility
- [ ] Color contrast meets WCAG AA (4.5:1 for text)
- [ ] Focus states are visible
- [ ] Interactive elements are keyboard accessible
- [ ] Theme toggle is accessible

#### Performance
- [ ] No layout shift on page load
- [ ] Font loading doesn't cause FOUT (use font-display: swap)
- [ ] Theme toggle is instant (no flash)

---

## Implementation Notes

### For the Implementing Agent

1. **Start with the theme system:**
   - Update `index.css` with new CSS variables
   - Add Inter font to `index.html`
   - Create `theme-toggle.tsx` component
   - Test light/dark switching works

2. **Build the sidebar:**
   - Create `Sidebar.tsx` and `SidebarLayout.tsx`
   - Integrate with existing auth context
   - Add responsive behavior (mobile collapse)
   - Write tests for navigation

3. **Update base components:**
   - Work through each component in `components/ui/`
   - Focus on: button, card, input, badge, progress first
   - Ensure all variants still work

4. **Update pages one by one:**
   - Start with Layout and simpler pages (Login, Register)
   - Then move to complex pages (SurveyCreate, SurveyResults)
   - Keep checking visual consistency

5. **Add polish:**
   - Smooth transitions (150ms ease)
   - Hover states on all interactive elements
   - Loading states where appropriate

### Reference Patterns

- Existing components: `frontend/src/components/ui/`
- Current layout: `frontend/src/components/layout/`
- Auth context: `frontend/src/contexts/AuthContext.tsx`
- Routing: `frontend/src/App.tsx`

### Test Data
- Use existing test users from auth system
- Survey test data in Supabase
- Test on both Chrome and Firefox

### Common Gotchas
- Don't forget to update Chart colors in SurveyResults
- Ensure dark mode works on all pages, not just home
- Test mobile navigation thoroughly
- Watch for color contrast issues in dark mode

---

## Out of Scope

- New features or functionality (this is visual only)
- Backend changes
- Database schema changes
- New pages
- Animation libraries (use CSS transitions only)
- Component library migration (keep shadcn/ui)

---

## Figma/Design Reference

**Inspiration sites:**
- claude.ai (primary reference)
- linear.app (secondary - clean sidebar)
- notion.so (secondary - warm tones)

**Color tools:**
- Use oklch or HSL for color consistency
- Test contrast at webaim.org/resources/contrastchecker

---

## Post-Implementation

After completing the overhaul:
1. Run full test suite (`/test`)
2. Visual review on mobile and desktop
3. Check all pages in both light and dark mode
4. Verify no accessibility regressions
