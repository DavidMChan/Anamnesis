# Feature: User LLM Configuration with Vault Encryption

## Status
- [x] Planning complete
- [x] Ready for implementation
- [x] Implementation complete

## Priority
**Medium** - 讓每個用戶可以設定自己的 LLM 配置

## Description
將 LLM 配置從 worker 的 .env 改為由用戶在 Settings 頁面設定，儲存在資料庫中。API keys 使用 Supabase Vault 加密儲存。Worker 執行 survey 時從用戶的資料庫配置讀取設定。

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Settings Page                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  LLM Provider:  [OpenRouter ▼]                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────── OpenRouter Settings ────────────────┐                │
│  │  API Key:       [sk-or...***] [Change]             │                │
│  │  Model:         [anthropic/claude-3-haiku    ]     │                │
│  └────────────────────────────────────────────────────┘                │
│                                                                         │
│  ┌─────────────── vLLM Settings ──────────────────────┐                │
│  │  Endpoint:      [http://localhost:8000/v1    ]     │                │
│  │  Model:         [meta-llama/Llama-3-70b      ]     │                │
│  │  API Key:       [            ] (optional)          │                │
│  └────────────────────────────────────────────────────┘                │
│                                                                         │
│  ┌─────────────── Generation Settings ────────────────┐                │
│  │  Temperature:   [0.0        ]                      │                │
│  │  Max Tokens:    [64         ]                      │                │
│  └────────────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Supabase                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  users.llm_config (JSONB)           │  vault.secrets (encrypted)        │
│  ─────────────────────────────────  │  ─────────────────────────────    │
│  • provider: "openrouter"           │  • user_{id}_openrouter_key       │
│  • openrouter_model: "..."          │  • user_{id}_vllm_key             │
│  • vllm_endpoint: "..."             │                                   │
│  • vllm_model: "..."                │                                   │
│  • temperature: 0.0                 │                                   │
│  • max_tokens: 64                   │                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Worker                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Get survey task with user_id                                        │
│  2. Fetch user's llm_config from database                               │
│  3. Decrypt API key from vault using get_user_api_key(user_id, type)    │
│  4. Call LLM with user's configuration                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### User Settings Schema

**users.llm_config** (JSONB) - 新結構：
```typescript
interface LLMConfig {
  // Provider selection
  provider?: 'openrouter' | 'vllm'

  // OpenRouter settings
  openrouter_model?: string        // e.g., "anthropic/claude-3-haiku"

  // vLLM settings
  vllm_endpoint?: string           // e.g., "http://localhost:8000/v1"
  vllm_model?: string              // e.g., "meta-llama/Llama-3-70b"

  // Generation settings
  temperature?: number             // e.g., 0.0
  max_tokens?: number              // e.g., 64
}
```

**API Keys** (stored in Vault, not in llm_config):
- `user_{user_id}_openrouter_key` - OpenRouter API key
- `user_{user_id}_vllm_key` - vLLM API key (optional)

### Database Changes

1. **Enable Vault extension** (if not already)
   ```sql
   CREATE EXTENSION IF NOT EXISTS supabase_vault;
   ```

2. **Vault helper functions**
   ```sql
   -- Store API key for user (type = 'openrouter' | 'vllm')
   CREATE FUNCTION store_user_api_key(
     p_user_id UUID,
     p_key_type TEXT,
     p_api_key TEXT
   ) RETURNS BOOLEAN

   -- Get masked API key for display
   CREATE FUNCTION get_masked_api_key(
     p_user_id UUID,
     p_key_type TEXT
   ) RETURNS TEXT

   -- Get decrypted API key (for worker only, via service role)
   CREATE FUNCTION get_user_api_key(
     p_user_id UUID,
     p_key_type TEXT
   ) RETURNS TEXT

   -- Delete API key
   CREATE FUNCTION delete_user_api_key(
     p_user_id UUID,
     p_key_type TEXT
   ) RETURNS BOOLEAN
   ```

### Files to Create
- `supabase/migrations/007_user_llm_config_vault.sql` - Vault setup & functions

### Files to Modify

**Frontend:**
- `frontend/src/types/database.ts` - Update `LLMConfig` interface
- `frontend/src/pages/Settings.tsx` - Add all LLM config fields
- `frontend/src/contexts/AuthContext.tsx` - Handle multiple API keys by type
- `frontend/src/hooks/useAuth.ts` - Add methods for managing configs

**Worker:**
- `worker/src/config.py` - Remove LLM settings from env, add db fetch
- `worker/src/llm.py` - Accept user config instead of env config
- `worker/src/worker.py` - Fetch user config before running survey

### Key Decisions

1. **兩個 API key**：OpenRouter 和 vLLM 各自獨立的 key
2. **Provider 切換**：用戶選擇 provider 後，UI 顯示對應的設定區塊
3. **Worker fallback**：如果用戶沒設定，使用 .env 的預設值（供 admin/測試用）
4. **Secret naming**：`user_{user_id}_{key_type}_key` 格式

## Pass Criteria

### Unit Tests

**Vault Functions:**
- [ ] `store_user_api_key` 成功儲存 openrouter key
- [ ] `store_user_api_key` 成功儲存 vllm key
- [ ] `store_user_api_key` 覆蓋已存在的 key
- [ ] `get_masked_api_key` 回傳正確遮蔽格式
- [ ] `get_masked_api_key` 用戶沒有 key 時回傳 null
- [ ] `get_user_api_key` 回傳正確明文
- [ ] `delete_user_api_key` 成功刪除

**Frontend:**
- [x] Provider 切換時顯示對應設定區塊
- [x] 儲存 llm_config 到資料庫
- [x] 顯示遮蔽的 API keys

**Worker:**
- [x] 從資料庫讀取用戶配置
- [x] 使用正確的 API key 呼叫 LLM
- [x] Fallback 到 .env 預設值

### E2E Tests
- [ ] 用戶設定 OpenRouter provider + key + model → 儲存成功 → 顯示遮蔽版本
- [ ] 用戶切換到 vLLM → 設定 endpoint + model → 儲存成功
- [ ] 用戶更新 temperature 和 max_tokens → 儲存成功
- [ ] 用戶清空 API key → 刪除 secret → 顯示空白

### Acceptance Criteria
- [x] Settings 頁面顯示所有 LLM 配置欄位
- [x] API keys 儲存在 `vault.secrets` 表中（加密）
- [x] 其他配置儲存在 `users.llm_config` 欄位
- [x] Worker 從用戶配置執行 survey
- [x] 前端無法取得明文 API key（RLS 保護）

## Implementation Notes

### For the Implementing Agent

1. **Settings UI 區塊邏輯**
   ```tsx
   // 根據 provider 顯示對應區塊
   {provider === 'openrouter' && <OpenRouterSettings />}
   {provider === 'vllm' && <VLLMSettings />}
   // Generation settings 永遠顯示
   <GenerationSettings />
   ```

2. **Worker 配置優先順序**
   ```python
   # 1. 嘗試從用戶配置讀取
   # 2. Fallback 到 .env 預設值
   def get_llm_config(user_id: str) -> LLMConfig:
       user_config = db.get_user_llm_config(user_id)
       if user_config and user_config.provider:
           return user_config
       return env_default_config
   ```

3. **API Key 遮蔽格式**
   - 顯示前 5 字元 + `...` + 後 3 字元
   - 例如：`sk-or...abc`

4. **現有程式碼參考**
   - `worker/src/config.py` - 目前的環境變數配置
   - `worker/src/llm.py` - LLM 呼叫邏輯
   - `frontend/src/pages/Settings.tsx` - 現有 UI

### Migration Path
無需資料遷移，舊的 `llm_config` 結構會被新結構覆蓋。

## Out of Scope
- Key rotation 機制
- Audit log
- 多組 API key profile
- 預設 model 列表（用戶自行輸入）
