<script setup lang="ts">
/**
 * LockScreen —— 全屏锁屏页（亚克力模糊 + PIN 键盘 + 手机端解锁）
 * 仅在 ctx.lock.state.locked 时渲染；解锁方式：
 *   · PIN（首次锁定前设置，4-6 位数字）
 *   · 「手机解锁」：向云端中继发请求，同账号手机端前台弹窗确认
 */
import { inject, ref, computed, watch } from 'vue'
import Icon from './Icon.vue'
import { resUrl } from '../../core/res'
import { fallbackAvatar } from '../../core/util'

const ctx = inject<any>('ctx')
const lock = ctx.lock
const auth = ctx.auth
const ui = ctx.ui

const pin = ref('')
const err = ref('')
const setting = ref(false)      // 首次锁定前设置 PIN 的流程
const pin2 = ref('')
const busy = ref(false)

const visible = computed(() => !!lock?.state?.locked)
const status = computed(() => lock?.state?.reqStatus || '')
const avatar = computed(() => {
  const a = auth?.state?.user?.avatar
  return a ? resUrl(a) : fallbackAvatar(auth?.state?.user?.name)
})

watch(visible, (v) => { if (!v) { pin.value = ''; err.value = ''; setting.value = false } })

function tap(d: string) {
  if (setting.value) return
  if (pin.value.length >= 6) return
  pin.value += d
  err.value = ''
  if (pin.value.length === 6) tryUnlock()
}
function backspace() { pin.value = pin.value.slice(0, -1); err.value = '' }

async function tryUnlock() {
  if (busy.value) return
  busy.value = true
  try {
    const ok = await lock.checkPin(pin.value)
    if (ok) { await lock.unlock(); ui?.toast?.('已解锁', 'success') }
    else { err.value = 'PIN 不正确'; pin.value = '' }
  } finally { busy.value = false }
}

/** 首次锁定：还没设过 PIN 时先让设一个（手机解锁的兜底） */
async function saveNewPin() {
  if (pin.value.length < 4 || pin.value !== pin2.value) { err.value = '两次输入不一致或不足 4 位'; return }
  const ok = await lock.setPin(pin.value)
  if (!ok) { err.value = 'PIN 需为 4-6 位数字'; return }
  setting.value = false
  pin.value = ''
  pin2.value = ''
  err.value = ''
  ui?.toast?.('PIN 已设置，请牢记（手机不在身边时用它解锁）', 'info')
}

/** 忘记密码：用账号密码或 token 验证身份后清除旧 PIN，重设新 PIN */
const forgot = ref(false)
const fEmail = ref('')
const fPass = ref('')
const fToken = ref('')
const resetBusy = ref(false)
async function forgotReset() {
  if (resetBusy.value) return
  resetBusy.value = true
  try {
    if (fToken.value.trim()) {
      // 只验证不登录：失败时保持锁屏并报错，不会把已登录会话踢回登录页
      await auth.verifyToken(fToken.value)
    } else if (fEmail.value.trim() && fPass.value) {
      // 账密验证：用临时 token 校验（不覆盖当前会话）——先取当前 token 备份语义由 verifyToken 保证
      const t = await ctx.api.login(fEmail.value.trim(), fPass.value, auth.deviceId || 'web', 'web')
      await auth.verifyToken(t)
    } else {
      err.value = '请填写账号密码或 token'
      return
    }
    await lock.clearPin()                          // 身份验证通过 → 清旧 PIN
    forgot.value = false
    setting.value = true                           // 进入重设 PIN 流程
    pin.value = ''; pin2.value = ''
    ui?.toast?.('身份验证通过，请设置新 PIN', 'success')
  } catch (e: any) {
    err.value = '验证失败：' + (e?.message || '账号密码或 token 不正确')
  } finally { resetBusy.value = false }
}
</script>

<template>
  <div v-if="visible" class="ls-mask">
    <div class="ls-box">
      <img class="ls-av" :src="avatar" alt="" @error="(e: any) => (e.target.src = fallbackAvatar(auth?.state?.user?.name))" />
      <div class="ls-name">{{ auth?.state?.user?.name || '云湖牢大版' }}</div>
      <div class="ls-sub">设备已锁定</div>

      <!-- 首次锁定：设置 PIN -->
      <template v-if="setting">
        <div class="ls-hint">首次锁定，请先设置 4-6 位数字 PIN（手机解锁的兜底）</div>
        <input v-model="pin" type="password" inputmode="numeric" maxlength="6" class="ls-pin" placeholder="设置 PIN" />
        <input v-model="pin2" type="password" inputmode="numeric" maxlength="6" class="ls-pin" placeholder="再输一次" />
        <div class="ls-row">
          <button class="ls-btn" @click="setting = false; pin = ''">返回</button>
          <button class="ls-btn primary" @click="saveNewPin">保存并锁定</button>
        </div>
      </template>

      <!-- 常规锁屏：PIN 键盘 + 忘记密码 -->
      <template v-else-if="!forgot">
        <div v-if="!lock?.state?.hasPin" class="ls-hint">
          尚未设置 PIN ——
          <button class="ls-link" @click="setting = true">现在设置</button>
        </div>
        <div class="ls-dots">
          <span v-for="i in 6" :key="i" class="dot" :class="{ on: pin.length >= i }"></span>
        </div>
        <div v-if="err" class="ls-err">{{ err }}</div>
        <div class="ls-pad">
          <button v-for="d in ['1','2','3','4','5','6','7','8','9']" :key="d" class="ls-key" @click="tap(d)">{{ d }}</button>
          <span></span>
          <button class="ls-key" @click="tap('0')">0</button>
          <button class="ls-key ghost-key" title="退格" @click="backspace"><Icon name="undo" :size="16" /></button>
        </div>
        <div class="ls-row">
          <button class="ls-btn" :disabled="busy || pin.length < 4" @click="tryUnlock">解锁</button>
          <button class="ls-btn" @click="forgot = true; err = ''">忘记密码</button>
        </div>
      </template>

      <!-- 忘记密码：账号密码或 token 验证身份 → 清旧 PIN → 重设 -->
      <template v-else>
        <div class="ls-hint">输入账号密码或 token 验证身份，通过后重设 PIN</div>
        <input v-model="fEmail" class="ls-pin ls-text" placeholder="账号邮箱（用密码验证时填）" />
        <input v-model="fPass" type="password" class="ls-pin ls-text" placeholder="账号密码" />
        <div class="ls-or">或</div>
        <input v-model="fToken" type="password" class="ls-pin ls-text" placeholder="Token（二选一）" />
        <div v-if="err" class="ls-err">{{ err }}</div>
        <div class="ls-row">
          <button class="ls-btn" @click="forgot = false; err = ''">返回</button>
          <button class="ls-btn primary" :disabled="resetBusy" @click="forgotReset">{{ resetBusy ? '验证中…' : '验证并重设' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ls-mask {
  position: fixed; inset: 0; z-index: 20000; display: grid; place-items: center;
  background: rgba(18, 18, 22, .72); backdrop-filter: blur(22px) saturate(1.2);
}
.ls-box {
  width: min(340px, 92vw); display: flex; flex-direction: column; align-items: center; gap: 12px;
  background: rgba(32, 32, 38, .82); border: 1px solid rgba(255, 255, 255, .09);
  border-radius: 18px; padding: 26px 24px; box-shadow: 0 24px 70px rgba(0, 0, 0, .5);
}
.ls-av { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: #333; }
.ls-name { font-size: 16px; font-weight: 600; color: #fff; }
.ls-sub { font-size: 12px; color: rgba(255, 255, 255, .55); margin-top: -6px; }
.ls-hint { font-size: 12px; color: rgba(255, 255, 255, .6); text-align: center; line-height: 1.6; }
.ls-link { background: none; border: none; color: var(--acc); cursor: pointer; font-size: 12px; padding: 0; }
.ls-pin {
  width: 100%; background: rgba(255, 255, 255, .07); border: 1px solid rgba(255, 255, 255, .14);
  border-radius: 9px; color: #fff; padding: 9px 12px; font-size: 14px; outline: none; text-align: center;
  letter-spacing: 4px;
}
.ls-dots { display: flex; gap: 10px; margin: 4px 0; }
.ls-dots .dot {
  width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid rgba(255, 255, 255, .4);
}
.ls-dots .dot.on { background: var(--acc); border-color: var(--acc); }
.ls-err { font-size: 12px; color: #ff8080; }
.ls-pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%; }
.ls-key {
  height: 44px; border-radius: 10px; border: none; background: rgba(255, 255, 255, .08);
  color: #fff; font-size: 17px; cursor: pointer;
}
.ls-key:hover { background: rgba(255, 255, 255, .16); }
.ls-key:active { background: var(--acc); }
.ghost-key { display: grid; place-items: center; }
.ls-row { display: flex; gap: 10px; width: 100%; justify-content: center; }
.ls-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, .16); background: rgba(255, 255, 255, .06);
  color: #fff; font-size: 13px; cursor: pointer;
}
.ls-btn:hover { background: rgba(255, 255, 255, .14); }
.ls-btn.primary { background: var(--acc); border-color: transparent; }
.ls-text { letter-spacing: 0; text-align: left; font-size: 13px; }
.ls-or { text-align: center; font-size: 11px; color: rgba(255, 255, 255, .45); margin: -4px 0; }
.ls-status { font-size: 12px; color: rgba(255, 255, 255, .6); text-align: center; }
.ls-status.bad { color: #ff9a9a; }
</style>
