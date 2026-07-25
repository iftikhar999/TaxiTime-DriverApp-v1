/**
 * ThemedDatePicker
 *
 * Three-column (year / month / day) scrollable picker rendered in a
 * modal that matches the driver console's dark + amber aesthetic.
 *
 * No native deps — pure JS + ScrollView snap-to-interval. Works
 * identically on Android + iOS. Use when the stock text-input YYYY-MM-DD
 * flow was too error-prone for drivers in the field.
 *
 *   <ThemedDatePicker
 *     visible={open}
 *     value={'2027-12-31'}         // ISO date string or null/undefined
 *     minDate={new Date()}          // don't allow selecting past dates
 *     onCancel={close}
 *     onConfirm={(iso) => setExpiry(iso)}   // iso = 'YYYY-MM-DD'
 *   />
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../theme/colors';

type Props = {
  visible: boolean;
  value?: string | null;
  minDate?: Date;
  maxDate?: Date;
  title?: string;
  onCancel: () => void;
  onConfirm: (iso: string) => void;
};

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const PADDING = ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2);

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const daysInMonth = (year: number, monthZeroIndexed: number) =>
  new Date(year, monthZeroIndexed + 1, 0).getDate();

type WheelProps = {
  items: Array<{ label: string; value: number }>;
  selectedIndex: number;
  onChange: (index: number) => void;
  width: number;
};

const Wheel: React.FC<WheelProps> = ({ items, selectedIndex, onChange, width }) => {
  const scrollRef = useRef<ScrollView>(null);
  const lastReportedRef = useRef(selectedIndex);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      y: selectedIndex * ITEM_HEIGHT,
      animated: false,
    });
  }, [selectedIndex]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    if (clamped !== lastReportedRef.current) {
      lastReportedRef.current = clamped;
      onChange(clamped);
    }
    // Snap in case the user stopped mid-row.
    scrollRef.current?.scrollTo({ y: clamped * ITEM_HEIGHT, animated: true });
  };

  return (
    <View style={[styles.wheelWrap, { width }]}>
      <View pointerEvents="none" style={styles.wheelHighlight} />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumEnd}
        contentContainerStyle={{ paddingVertical: PADDING }}
      >
        {items.map((it, i) => {
          const isSelected = i === selectedIndex;
          return (
            <View key={`${it.value}-${i}`} style={styles.wheelItem}>
              <Text
                style={[
                  styles.wheelItemText,
                  isSelected ? styles.wheelItemTextSelected : null,
                ]}
              >
                {it.label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

export const ThemedDatePicker: React.FC<Props> = ({
  visible,
  value,
  minDate,
  maxDate,
  title = 'Select date',
  onCancel,
  onConfirm,
}) => {
  const today = useMemo(() => new Date(), []);

  // Compute year range: default is [this year, this year + 20] so the
  // driver can pick document expiries up to two decades out without
  // scrolling forever.
  const years = useMemo(() => {
    const min = minDate ? minDate.getFullYear() : today.getFullYear();
    const max = maxDate ? maxDate.getFullYear() : today.getFullYear() + 20;
    const out: number[] = [];
    for (let y = min; y <= max; y++) out.push(y);
    return out;
  }, [minDate, maxDate, today]);

  const initial = useMemo(() => {
    const parsed = value ? new Date(value) : null;
    const seed =
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed
        : minDate && minDate.getTime() > today.getTime()
          ? minDate
          : today;
    return {
      year: seed.getFullYear(),
      month: seed.getMonth(),
      day: seed.getDate(),
    };
  }, [value, minDate, today]);

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  // If the modal is reopened with a different `value`, reseed.
  useEffect(() => {
    if (visible) {
      setYear(initial.year);
      setMonth(initial.month);
      setDay(initial.day);
    }
  }, [visible, initial]);

  // Clamp day when year/month change (e.g. Feb 30 → Feb 28).
  useEffect(() => {
    const max = daysInMonth(year, month);
    if (day > max) setDay(max);
  }, [year, month, day]);

  const yearItems = useMemo(
    () => years.map((y) => ({ label: String(y), value: y })),
    [years],
  );
  const monthItems = useMemo(
    () => MONTHS.map((m, i) => ({ label: m, value: i })),
    [],
  );
  const dayItems = useMemo(() => {
    const max = daysInMonth(year, month);
    return Array.from({ length: max }, (_, i) => ({
      label: pad2(i + 1),
      value: i + 1,
    }));
  }, [year, month]);

  const yearIndex = Math.max(0, yearItems.findIndex((y) => y.value === year));
  const monthIndex = month;
  const dayIndex = Math.max(0, Math.min(dayItems.length - 1, day - 1));

  const handleConfirm = () => {
    const iso = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    onConfirm(iso);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      {/* The backdrop Pressable sits BEHIND the card (absolute fill) rather
          than wrapping it. Wrapping the card in Pressable made Android's
          PressResponder steal swipe gestures from the ScrollView-based date
          wheels, so the wheels couldn't be scrolled. This layout keeps the
          card a plain View while still letting a tap outside dismiss. */}
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          android_disableSound
        />
        <View style={styles.card}>
          <View style={styles.stripe} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.preview}>
            {MONTHS[month]} {pad2(day)}, {year}
          </Text>

          <View style={styles.wheels}>
            <Wheel
              items={monthItems}
              selectedIndex={monthIndex}
              onChange={(i) => setMonth(monthItems[i].value)}
              width={90}
            />
            <Wheel
              items={dayItems}
              selectedIndex={dayIndex}
              onChange={(i) => setDay(dayItems[i].value)}
              width={70}
            />
            <Wheel
              items={yearItems}
              selectedIndex={yearIndex}
              onChange={(i) => setYear(yearItems[i].value)}
              width={90}
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancel]}
              onPress={onCancel}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirm]}
              onPress={handleConfirm}
              activeOpacity={0.9}
            >
              <Text style={styles.confirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,8,14,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1a1d29',
    borderRadius: 20,
    paddingTop: 22,
    paddingBottom: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 180, 0, 0.22)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 14,
  },
  stripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: Colors.accent?.highlight || '#f5b400',
  },
  title: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  preview: {
    color: '#f5b400',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  wheels: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  wheelWrap: {
    height: WHEEL_HEIGHT,
    backgroundColor: '#0f111a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  wheelHighlight: {
    position: 'absolute',
    top: PADDING,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    backgroundColor: 'rgba(245,180,0,0.08)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(245,180,0,0.35)',
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '600',
  },
  wheelItemTextSelected: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'stretch',
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cancelText: {
    color: '#d0d4e2',
    fontSize: 14,
    fontWeight: '600',
  },
  confirm: {
    backgroundColor: '#f5b400',
  },
  confirmText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});

export default ThemedDatePicker;
