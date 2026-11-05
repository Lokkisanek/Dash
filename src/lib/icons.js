/**
 * Central icon map — import only what we use so Vite can tree-shake lucide.
 */
import {
  Bath,
  BedDouble,
  Blinds,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Coffee,
  Copy,
  DoorOpen,
  Fan,
  Flame,
  Home,
  Lightbulb,
  Minus,
  Plus,
  Power,
  Sofa,
  Sparkles,
  Square,
  Sunrise,
  Sunset,
  Thermometer,
  Tv,
  Wifi,
  X,
} from 'lucide-vue-next'

export const icons = {
  Bath,
  BedDouble,
  Blinds,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Coffee,
  Copy,
  DoorOpen,
  Fan,
  Flame,
  Home,
  Lightbulb,
  Minus,
  Plus,
  Power,
  Sofa,
  Sparkles,
  Square,
  Sunrise,
  Sunset,
  Thermometer,
  Tv,
  Wifi,
  X,
}

export function resolveIcon(name, fallback = 'Sparkles') {
  return icons[name] || icons[fallback] || Sparkles
}
