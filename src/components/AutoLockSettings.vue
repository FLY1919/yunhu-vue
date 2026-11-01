<script setup lang="ts">
import { inject, ref, watch } from 'vue'
const ctx = inject<any>('ctx'), lock = ctx.lock
const oldPin = ref(''), changing = ref(false)
const pin = ref(''), repeat = ref(''), minutes = ref(lock.state.preferences.blurMinutes || 5), error = ref('')
watch(() => lock.state.preferences.blurMinutes, value => { if (value > 0) minutes.value = value })
async function save(patch: any) { try { error.value = ''; await lock.setAutoLock(patch) } catch (e: any) { error.value = e.message } }
async function createPin() {
  try {
  if (pin.value !== repeat.value || !/^\d{4,6}$/.test(pin.value)) { error.value = '请填写两次相同的 4–6 位数字 PIN'; return }
  if (lock.state.hasPin && !(await lock.checkPin(oldPin.value))) { error.value = '原 PIN 不正确'; return }
  if (await lock.setPin(pin.value)) { pin.value = ''; repeat.value = ''; oldPin.value = ''; changing.value = false; error.value = ''; ctx.ui?.toast?.('锁定 PIN 已设置', 'success') }
  } catch (e: any) { error.value = e.message || '保存 PIN 失败' }
}
</script>
<template>
  <div class="auto-lock-settings">
    <button v-if="lock.state.hasPin" class="ghost small" @click="changing = !changing">{{ changing ? '取消修改' : '修改 PIN' }}</button><template v-if="!lock.state.hasPin || changing"><input v-if="lock.state.hasPin" v-model="oldPin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" aria-label="原 PIN" placeholder="原 PIN" /><p class="dim small">先设置 PIN，即可开启自动锁定。</p><div class="pin-fields"><input v-model="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" aria-label="设置锁定 PIN" placeholder="4–6 位数字 PIN" /><input v-model="repeat" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" aria-label="确认锁定 PIN" placeholder="再次输入 PIN" /><button class="ghost small" @click="createPin">设置 PIN</button></div></template>
    <label class="auto-lock-row"><span>软件启动时锁定</span><input type="checkbox" :disabled="!lock.state.hasPin" :checked="lock.state.preferences.startup" @change="save({ startup: ($event.target as HTMLInputElement).checked })" /></label>
    <label class="auto-lock-row"><span>反截屏（Windows 桌面版）</span><input type="checkbox" :disabled="!ctx.lock.captureSupported" :checked="lock.state.preferences.captureProtection" @change="save({ captureProtection: ($event.target as HTMLInputElement).checked })" /></label>
    <p class="dim small">反截屏对支持的系统截图与录屏工具隐藏窗口内容，无法阻止外部拍摄。锁定期间暂停消息 Toast，并清除已有消息通知；解锁后恢复新通知。</p>
    <label class="auto-lock-row"><span>最小化时锁定</span><input type="checkbox" :disabled="!lock.state.hasPin" :checked="lock.state.preferences.minimize" @change="save({ minimize: ($event.target as HTMLInputElement).checked })" /></label>
    <label class="auto-lock-row"><span>失去焦点后自动锁定</span><input type="checkbox" :disabled="!lock.state.hasPin" :checked="lock.state.preferences.blurMinutes > 0" @change="save({ blurMinutes: ($event.target as HTMLInputElement).checked ? minutes : 0 })" /></label>
    <label v-if="lock.state.preferences.blurMinutes > 0" class="auto-lock-row"><span>失去焦点后等待（分钟）</span><input v-model.number="minutes" aria-label="失焦锁定等待分钟数" type="number" min="1" max="1440" step="1" @change="minutes = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 1))); save({ blurMinutes: minutes })" /></label>
    <p class="dim small">返回软件会取消未到期的计时；已超过等待时间则保持锁定。浏览器版本在页面隐藏时按最小化处理。</p><p v-if="error" class="err small" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.auto-lock-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 10px 0; font-size: 13px; }
.auto-lock-row input[type=number] { width: 85px; }.pin-fields { display: flex; flex-wrap: wrap; gap: 8px; }.pin-fields input { min-width: 100px; width: 150px; }.auto-lock-settings p { line-height: 1.7; }
</style>
