<script setup lang="ts">
import { computed, inject } from 'vue'
import { shareBitrates, shareFrameRates, shareResolutions, type ScreenShareProfile } from '../core/screen-share'

const ctx = inject<any>('ctx')
const calls = ctx.calls
const profile = computed<ScreenShareProfile>(() => calls.state.screenProfile)
const actual = computed<MediaTrackSettings | null>(() => calls.state.screenActual)
async function change(key: keyof ScreenShareProfile, event: Event) {
  const select = event.currentTarget as HTMLSelectElement
  await calls.setScreenProfile({ ...profile.value, [key]: Number(select.value) })
  select.value = String(profile.value[key])
}
</script>

<template>
  <fieldset class="share-settings" :disabled="calls.state.videoPending">
    <legend>屏幕共享画质</legend>
    <div class="share-fields">
      <label>分辨率<select :value="profile.height" @change="change('height', $event)">
        <option v-for="height in shareResolutions" :key="height" :value="height">{{ height ? height + 'p' : '原始分辨率' }}</option>
      </select></label>
      <label>帧率<select :value="profile.fps" @change="change('fps', $event)">
        <option v-for="fps in shareFrameRates" :key="fps" :value="fps">{{ fps ? fps + ' FPS' : '跟随来源' }}</option>
      </select></label>
      <label>码率上限<select :value="profile.mbps" @change="change('mbps', $event)">
        <option v-for="mbps in shareBitrates" :key="mbps" :value="mbps">{{ mbps ? mbps + ' Mbps' : '自动' }}</option>
      </select></label>
    </div>
    <p v-if="actual?.width && actual?.height" class="share-actual" role="status">
      当前采集 {{ actual.width }} × {{ actual.height }}<template v-if="actual.frameRate"> · {{ Number(actual.frameRate.toFixed(1)) }} FPS</template>
    </p>
    <p>分辨率和帧率是采集目标，实际表现取决于共享来源、系统和网络。</p>
  </fieldset>
</template>

<style scoped>
.share-settings { display:grid; gap:8px; min-width:0; margin:0; padding:10px 12px 12px; border:1px solid var(--line); border-radius:12px; color:var(--fg); }
.share-settings legend { padding:0 5px; font-size:13px; font-weight:650; }
.share-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,94px),1fr)); gap:8px; }
.share-fields label { display:grid; gap:5px; min-width:0; font-size:12px; color:var(--fg2); }
.share-fields select { min-width:0; width:100%; }
.share-settings p { margin:0; font-size:12px; line-height:1.45; color:var(--fg2); }
.share-settings .share-actual { color:var(--fg); font-weight:650; }
</style>
