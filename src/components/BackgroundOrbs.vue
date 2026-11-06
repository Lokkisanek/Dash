<script setup>
defineProps({
  dark: { type: Boolean, default: false },
})
</script>

<template>
  <div class="dashboard-orbs" :class="{ 'is-dark': dark }" aria-hidden="true">
    <span class="orb o1" />
    <span class="orb o2" />
    <span class="orb o3" />
    <span class="orb o4" />
  </div>
</template>

<style scoped>
.dashboard-orbs {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(48px);
  opacity: 0.7;
  mix-blend-mode: multiply;
}

.is-dark .orb {
  opacity: 0.45;
  mix-blend-mode: screen;
}

.o1 {
  width: 280px;
  height: 280px;
  top: -8%;
  left: -10%;
  background: #ff8ad0;
}

.o2 {
  width: 320px;
  height: 320px;
  top: 10%;
  right: -16%;
  background: #b08cff;
}

.o3 {
  width: 260px;
  height: 260px;
  bottom: 18%;
  right: 8%;
  background: #ff9a6a;
}

.o4 {
  width: 220px;
  height: 220px;
  bottom: 8%;
  left: -6%;
  background: #ff6eb5;
}
</style>
