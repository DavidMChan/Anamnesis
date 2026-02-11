# Feature: Supabase Vault API Key Encryption

## Status
- [x] Planning complete
- [ ] Ready for implementation

## Priority
**Low** - 晚點做，目前先完成核心功能

## Description
使用 Supabase Vault 加密儲存用戶的 LLM API key，取代目前明文儲存在 `users.llm_config.api_key` 的做法。前端顯示遮蔽版本 (`sk-...***`)，Worker 透過 `vault.decrypted_secrets` 取得明文來呼叫 LLM。

## Technical Approach

### Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│    Frontend     │      │    Supabase     │      │     Worker      │
├─────────────────┤      ├─────────────────┤      ├─────────────────┤
│ 輸入 API key    │─────▶│ vault.secrets   │◀─────│ 解密讀取        │
│ 顯示 sk-...***  │◀─────│ (加密儲存)       │      │ 呼叫 LLM        │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

### Database Changes

1. **Enable Vault extension** (if not already)
   ```sql
   CREATE EXTENSION IF NOT EXISTS supabase_vault;
   ```

2. **Store API keys in Vault**
   - Use `vault.create_secret(secret, name, description)` to store
   - Secret name format: `user_api_key_{user_id}`
   - Remove `api_key` from `users.llm_config` JSONB

3. **Create helper functions**
   ```sql
   -- Store/update API key for user
   CREATE FUNCTION store_user_api_key(user_id UUID, api_key TEXT)

   -- Get masked API key for display (sk-...***)
   CREATE FUNCTION get_masked_api_key(user_id UUID)

   -- Get decrypted API key (for worker only)
   CREATE FUNCTION get_user_api_key(user_id UUID)
   ```

### Files to Create
- `supabase/migrations/XXX_vault_api_keys.sql` - Vault setup & functions

### Files to Modify
- `frontend/src/pages/Settings.tsx` - Use new API for storing/displaying key
- `frontend/src/types/database.ts` - Remove `api_key` from `LLMConfig`
- `frontend/src/contexts/AuthContext.tsx` - Add methods for API key management
- `worker/consumer.py` - Use `get_user_api_key()` function

### Key Decisions
- **Secret naming**: `user_api_key_{user_id}` 確保唯一性
- **遮蔽格式**: 顯示前 3 字元 + `...` + 後 3 字元 (e.g., `sk-...abc`)
- **直接呼叫 Vault**: Worker 用 service role 直接查詢，不透過 Edge Function

## Pass Criteria

### Unit Tests
- [ ] `store_user_api_key` 成功儲存時回傳 true
- [ ] `store_user_api_key` 覆蓋已存在的 key
- [ ] `get_masked_api_key` 回傳正確遮蔽格式
- [ ] `get_masked_api_key` 用戶沒有 key 時回傳 null
- [ ] `get_user_api_key` 回傳正確明文 (worker test)

### E2E Tests
- [ ] 用戶輸入 API key → 儲存成功 → 顯示遮蔽版本
- [ ] 用戶更新 API key → 覆蓋舊的 → 顯示新的遮蔽版本
- [ ] 用戶清空 API key → 刪除 secret → 顯示空白

### Acceptance Criteria
- [ ] API key 不再出現在 `users.llm_config` 欄位
- [ ] API key 儲存在 `vault.secrets` 表中（加密）
- [ ] Settings 頁面顯示遮蔽的 API key
- [ ] Worker 能成功解密並呼叫 LLM
- [ ] 前端無法取得明文 API key（RLS 保護）

## Implementation Notes

### For the Implementing Agent

1. **先確認 Vault extension 可用**
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'supabase_vault';
   ```

2. **Vault 基本用法**
   ```sql
   -- 建立 secret
   SELECT vault.create_secret('my-api-key', 'secret_name', 'description');

   -- 讀取加密版 (只有 id, name, description)
   SELECT * FROM vault.secrets WHERE name = 'secret_name';

   -- 讀取解密版 (需要權限)
   SELECT * FROM vault.decrypted_secrets WHERE name = 'secret_name';
   ```

3. **RLS 考量**
   - `vault.secrets` 預設只有 service role 能存取
   - 需要建立 wrapper function 讓前端能儲存（但不能讀取明文）

4. **參考現有程式碼**
   - Settings.tsx:116-128 - 現有 API key 輸入 UI
   - consumer.py:52-69 - 現有 `get_llm_config()`

### Migration Path
無需遷移，目前沒有正式用戶。

## Out of Scope
- 加密其他 `llm_config` 欄位 (provider, model, vllm_endpoint)
- Edge Function 中介層
- Key rotation 機制
- Audit log
