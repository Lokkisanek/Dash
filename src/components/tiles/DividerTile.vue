<script setup>
/**
 * Section divider: the section name on the left, a hairline filling the rest
 * of the row. Without a name it is just the line. (Not `.divider`: that is a
 * daisyUI component with its own lines.)
 */
defineProps({
  label: { type: String, default: '' },
})
</script>

<template>
  <div v-if="label" class="dash-divider" role="heading" aria-level="2">
    <span class="dash-divider__label">{{ label }}</span>
    <span class="dash-divider__line" aria-hidden="true" />
  </div>
  <div v-else class="dash-divider" role="separator">
    <span class="dash-divider__line" aria-hidden="true" />
  </div>
</template>

<style scoped>
.dash-divider {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 100%;
  padding: 0 4px 10px;
  user-select: none;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.dash-divider__label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1;
  text-transform: uppercase;
}

.dash-divider__line {
  flex: 1;
  height: 1px;
  margin-bottom: 0.3em;
  background: color-mix(in srgb, var(--color-base-content) 16%, transparent);
}
</style>
