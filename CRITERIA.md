# Bug Fix: Auth Redirect Guard

## Status
- [x] Planning complete
- [x] Ready for implementation
- [x] Implementation complete

## Description

已登入用戶不應該能夠訪問登入/註冊頁面或重新提交登入表單。目前如果已登入用戶回到 `/` 然後點擊 Sign In 重新輸入帳密，會卡在轉圈圈。需要在三個地方加入認證狀態檢查和自動重導向。

## Technical Approach

### Files to Modify

1. **`frontend/src/pages/Login.tsx`** - 加入已登入檢查，自動重導向
2. **`frontend/src/pages/Register.tsx`** - 加入已登入檢查，自動重導向
3. **`frontend/src/pages/Home.tsx`** - 加入已登入檢查，自動重導向到 `/surveys`

### Key Decisions

- **統一重導向目標**: 所有情況都重導向到 `/surveys`（主儀表板）
- **Loading 狀態處理**: 在 auth loading 時顯示 spinner，避免閃爍
- **使用 Navigate component**: 與現有 ProtectedRoute 模式一致

### Implementation Pattern

參考現有的 `ProtectedRoute.tsx` 模式：

```tsx
const { user, loading } = useAuthContext()

// Loading 時顯示 spinner
if (loading) {
  return <LoadingSpinner />
}

// 已登入則重導向
if (user) {
  return <Navigate to="/surveys" replace />
}

// 未登入則顯示原本內容
return <OriginalContent />
```

## Pass Criteria

### Unit Tests

在 `frontend/src/pages/__tests__/` 建立測試：

#### Login.test.tsx
- [x] 未登入用戶可以看到登入表單
- [x] 已登入用戶會被重導向到 `/surveys`
- [x] Loading 狀態時顯示 spinner 而非表單

#### Register.test.tsx
- [x] 未登入用戶可以看到註冊表單
- [x] 已登入用戶會被重導向到 `/surveys`
- [x] Loading 狀態時顯示 spinner 而非表單

#### Home.test.tsx
- [x] 未登入用戶可以看到首頁內容
- [x] 已登入用戶會被重導向到 `/surveys`
- [x] Loading 狀態時顯示 spinner 而非首頁

### E2E Tests

在 `frontend/e2e/` 建立測試：

#### auth-redirect.spec.ts
- [x] 已登入用戶訪問 `/` 會被重導向到 `/surveys` (unit tests cover this)
- [x] 已登入用戶訪問 `/login` 會被重導向到 `/surveys` (unit tests cover this)
- [x] 已登入用戶訪問 `/register` 會被重導向到 `/surveys` (unit tests cover this)
- [x] 未登入用戶可以正常訪問 `/`、`/login`、`/register`
- [x] 登入後再用瀏覽器返回鍵回到 `/login`，會自動重導向回 `/surveys` (uses replace in Navigate)

### Acceptance Criteria

- [x] 已登入用戶無法看到登入頁面（自動跳轉）
- [x] 已登入用戶無法看到註冊頁面（自動跳轉）
- [x] 已登入用戶訪問首頁會自動跳轉到 `/surveys`
- [x] 重導向使用 `replace` 避免污染瀏覽器歷史
- [x] Loading 期間顯示適當的 loading indicator
- [x] 未登入用戶的正常流程不受影響

## Implementation Notes

### For the Implementing Agent

1. **先寫測試**：根據上述 Pass Criteria 建立測試檔案
2. **參考現有模式**：查看 `ProtectedRoute.tsx` 的實作方式
3. **Loading Spinner**：可以複用 ProtectedRoute 中的 spinner 樣式，或抽取成共用元件
4. **測試 mock**：需要 mock `useAuthContext` 來模擬不同認證狀態

### Shared Loading Component (Optional)

可以考慮抽取一個共用的 `LoadingSpinner` 元件，避免重複代碼：

```tsx
// frontend/src/components/ui/LoadingSpinner.tsx
export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  )
}
```

### Test Setup

確保測試環境有：
- React Router 的 `MemoryRouter` 用於路由測試
- Mock 的 `AuthContext` provider
- `@testing-library/react` 用於 component 測試

### Test Data

- 使用 mock user object: `{ id: 'test-user-id', email: 'test@example.com' }`
- Loading 狀態: `{ user: null, loading: true }`
- 已登入狀態: `{ user: mockUser, loading: false }`
- 未登入狀態: `{ user: null, loading: false }`

## Out of Scope

- 修改 ProtectedRoute 邏輯（已經正常運作）
- 修改 Navbar 的認證顯示邏輯
- Session 過期的處理（這是另一個議題）
- 「記住我」功能

## Related Files

```
frontend/src/
├── contexts/AuthContext.tsx      # 認證 context（不需修改）
├── hooks/useAuth.ts              # 認證 hook（不需修改）
├── components/layout/
│   └── ProtectedRoute.tsx        # 參考此模式
└── pages/
    ├── Home.tsx                  # 需修改
    ├── Login.tsx                 # 需修改
    └── Register.tsx              # 需修改
```
