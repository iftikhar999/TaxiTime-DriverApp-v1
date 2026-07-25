/**
 * DocumentsScreen — driver compliance documents.
 *
 * Lists the driver's core documents (license, insurance, vehicle registration)
 * with status + expiry + re-upload action. Used by:
 *   1. Drawer menu → "Documents" entry
 *   2. Pre-shift gate toast — tapping it navigates here so the driver can
 *      fix whatever is blocking their shift start (see ShiftContext's
 *      checkShiftEligibility()).
 *
 * Upload flow: fully implemented — uses react-native-image-picker
 * (camera/library) with permission handling and a FormData POST. The GET
 * endpoint has a graceful profile-derived fallback so the screen is never
 * empty even before the backend list endpoint ships.
 *
 * Backend contract assumed (TODO — parallel backend work):
 *   GET    /api/drivers/documents               → list documents for self
 *   POST   /api/drivers/documents               → multipart FormData upload
 *                                                 field: file, type, expiryDate
 *   PUT    /api/drivers/documents/:id           → replace expiry/file
 *
 * Falls back to reading expiry fields off the driver profile if the dedicated
 * endpoint is absent so the screen is never empty.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
} from 'react-native-image-picker';
import httpClient from '../../services/httpClient';
import { fetchDriverProfile } from '../../services/driverService';
import { Colors } from '../../theme/colors';
import { ensureCameraPermission, ensureMediaLibraryPermission } from '../../utils/permissions';
import { themedAlert } from '../../components/ThemedAlert';
import ThemedDatePicker from '../../components/ThemedDatePicker';

type DocStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'EXPIRED' | 'MISSING';

type DocItem = {
  id?: string;
  type: 'LICENSE' | 'INSURANCE' | 'VEHICLE_REGISTRATION';
  label: string;
  status: DocStatus;
  expiryDate?: string | null;
  url?: string;
};

const DOC_TYPES: Array<Pick<DocItem, 'type' | 'label'>> = [
  { type: 'LICENSE', label: 'Driver License' },
  { type: 'INSURANCE', label: 'Insurance Certificate' },
  { type: 'VEHICLE_REGISTRATION', label: 'Vehicle Registration' },
];

const daysUntil = (iso?: string | null): number | null => {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.floor((ts - Date.now()) / (1000 * 60 * 60 * 24));
};

const badgeMeta = (d: DocItem): { color: string; bg: string; label: string } => {
  const days = daysUntil(d.expiryDate);
  if (d.status === 'REJECTED') return { color: '#ffffff', bg: Colors.danger, label: 'REJECTED' };
  if (d.status === 'MISSING') return { color: '#ffffff', bg: Colors.danger, label: 'MISSING' };
  if (d.status === 'EXPIRED' || (days !== null && days < 0)) {
    return { color: '#ffffff', bg: Colors.danger, label: 'EXPIRED' };
  }
  if (days !== null && days <= 30) {
    return { color: '#111827', bg: Colors.warning, label: `EXPIRES IN ${days}D` };
  }
  if (d.status === 'PENDING') return { color: '#111827', bg: Colors.warning, label: 'PENDING REVIEW' };
  return { color: '#ffffff', bg: Colors.success, label: 'VALID' };
};

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
};

const DocumentsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState<DocItem['type'] | null>(null);

  // Modal state for self-service document renewal. Opens when the driver
  // taps the Upload / Renew button on a card. They can (a) attach a photo
  // or PDF scan of the renewed document, and/or (b) enter the new expiry
  // date + document number. We POST multipart to /drivers/documents which
  // updates company_drivers (license) or vehicles (insurance / registration)
  // immediately — unblocking the eligibility gate without waiting for admin.
  const [renewModal, setRenewModal] = useState<null | DocItem>(null);
  const [formExpiry, setFormExpiry] = useState('');
  const [formDocNumber, setFormDocNumber] = useState('');
  const [pickedAsset, setPickedAsset] = useState<Asset | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      // Try the dedicated driver-documents endpoint first.
      // TODO(backend): implement GET /api/drivers/documents returning
      //   { success, data: [{ id, type, status, expiryDate, url }] }
      try {
        const resp = await httpClient.get('/drivers/documents');
        const data = resp.data?.data;
        if (Array.isArray(data)) {
          const mapped = DOC_TYPES.map((t) => {
            const match = data.find((d: any) => (d.type || '').toUpperCase() === t.type);
            return {
              ...t,
              id: match?.id,
              status: (match?.status || 'MISSING') as DocStatus,
              expiryDate: match?.expiryDate,
              url: match?.url,
            };
          });
          setDocs(mapped);
          return;
        }
      } catch (_err) {
        // fallthrough to profile-derived fallback
      }

      // Fallback: reuse whatever license/insurance expiry is exposed on the
      // profile so the user at least sees their own paperwork even if the
      // dedicated endpoint hasn't shipped yet.
      const profile: any = await fetchDriverProfile();
      const licenseExpiry = profile?.licenseExpiry ?? profile?.license?.expiryDate ?? null;
      const insuranceExpiry = profile?.insuranceExpiry ?? profile?.insurance?.expiryDate ?? null;
      const regExpiry = profile?.vehicle?.registrationExpiry ?? null;
      const mkStatus = (expiry: string | null): DocStatus => {
        if (!expiry) return 'MISSING';
        const d = daysUntil(expiry);
        if (d === null) return 'PENDING';
        if (d < 0) return 'EXPIRED';
        return 'APPROVED';
      };
      setDocs([
        { type: 'LICENSE', label: 'Driver License', status: mkStatus(licenseExpiry), expiryDate: licenseExpiry },
        { type: 'INSURANCE', label: 'Insurance Certificate', status: mkStatus(insuranceExpiry), expiryDate: insuranceExpiry },
        {
          type: 'VEHICLE_REGISTRATION',
          label: 'Vehicle Registration',
          status: mkStatus(regExpiry),
          expiryDate: regExpiry,
        },
      ]);
    } catch (err) {
      console.warn('[Documents] load failed', err);
      Toast.show({ type: 'error', text1: 'Could not load documents' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const startUpload = useCallback((doc: DocItem) => {
    setFormExpiry(doc.expiryDate || '');
    setFormDocNumber('');
    setPickedAsset(null);
    setRenewModal(doc);
  }, []);

  // Offer the driver a choice: snap a fresh photo via camera, or pick an
  // existing image/PDF from the gallery. Both paths check + request the
  // matching runtime permission first; launchCamera on Android silently
  // returns errorCode='camera_unavailable' when CAMERA isn't granted, so
  // we have to prompt ourselves rather than rely on the picker.
  const pickFromCamera = useCallback(async () => {
    const granted = await ensureCameraPermission();
    if (!granted) return;
    const res = await launchCamera({
      mediaType: 'photo',
      quality: 0.8,
      saveToPhotos: false,
      includeBase64: true,
    });
    if (res.didCancel) return;
    if (res.errorCode) {
      themedAlert('Camera', res.errorMessage || res.errorCode);
      return;
    }
    const asset = res.assets?.[0];
    if (asset) setPickedAsset(asset);
  }, []);

  const pickFromGallery = useCallback(async () => {
    const granted = await ensureMediaLibraryPermission();
    if (!granted) return;
    const res = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: 1,
      includeBase64: true,
    });
    if (res.didCancel) return;
    if (res.errorCode) {
      themedAlert('Gallery', res.errorMessage || res.errorCode);
      return;
    }
    const asset = res.assets?.[0];
    if (asset) setPickedAsset(asset);
  }, []);

  const submitRenewal = useCallback(async () => {
    if (!renewModal) return;
    if (!formExpiry || !/^\d{4}-\d{2}-\d{2}$/.test(formExpiry)) {
      themedAlert('Invalid date', 'Please pick a valid expiry date.', undefined, 'warning');
      return;
    }
    const ts = new Date(formExpiry).getTime();
    if (!Number.isFinite(ts) || ts < Date.now()) {
      themedAlert('Expiry in the past', 'The renewed document must have a future expiry date.', undefined, 'warning');
      return;
    }
    setUploading(renewModal.type);
    try {
      // Send as JSON with the file payload base64-encoded. Backend stores
      // the document inline on the `documents` row (as a data URI in
      // `fileUrl`) instead of writing it to disk — no /uploads/... files,
      // no orphan cleanup, and the scan travels with the DB backup.
      const payload: any = {
        type: renewModal.type,
        expiryDate: new Date(formExpiry).toISOString(),
        documentNumber: formDocNumber.trim() || undefined,
      };
      if (pickedAsset && pickedAsset.base64) {
        payload.fileBase64 = pickedAsset.base64;
        payload.fileMime = pickedAsset.type || 'image/jpeg';
        payload.fileName = pickedAsset.fileName || `${renewModal.type.toLowerCase()}.jpg`;
      }
      await httpClient.post('/drivers/documents', payload, {
        timeout: 60000,
      });
      Toast.show({
        type: 'success',
        text1: 'Document submitted',
        text2: pickedAsset
          ? 'File uploaded. Admin will verify shortly.'
          : 'Expiry refreshed. Admin will verify the physical copy.',
      });
      setRenewModal(null);
      setPickedAsset(null);
      await load();
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Update failed',
        text2: err?.response?.data?.message || err?.message || 'Please try again',
      });
    } finally {
      setUploading(null);
    }
  }, [renewModal, formExpiry, formDocNumber, pickedAsset, load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary[500]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}>
          <Icon name="chevron-left" size={26} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Documents</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}>
        <Text style={styles.subtitle}>
          Keep your documents up to date. Your shift is blocked if anything is expired.
        </Text>

        {docs.map((d) => {
          const b = badgeMeta(d);
          const days = daysUntil(d.expiryDate);
          return (
            <View key={d.type} style={styles.card}>
              <View style={styles.rowTop}>
                <View style={styles.iconWrap}>
                  <Icon
                    name={d.type === 'LICENSE' ? 'card-account-details' : d.type === 'INSURANCE' ? 'shield-check' : 'car'}
                    size={22}
                    color="#f5b400"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docLabel}>{d.label}</Text>
                  <Text style={styles.expiry}>
                    Expires: {formatDate(d.expiryDate)}
                    {days !== null && days >= 0 ? ` (${days}d)` : ''}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: b.bg }]}>
                  <Text style={[styles.badgeText, { color: b.color }]}>{b.label}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.uploadBtn, uploading === d.type && styles.uploadBtnDisabled]}
                onPress={() => startUpload(d)}
                disabled={uploading !== null}
                activeOpacity={0.85}>
                {uploading === d.type ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Icon name="upload" size={18} color="#FFFFFF" />
                    <Text style={styles.uploadText}>Upload new</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        <Text style={styles.footer}>
          Documents are reviewed by your company's dispatch team. If you think something is wrong,
          contact your fleet manager.
        </Text>
      </ScrollView>

      {/* Renewal modal — metadata-only update (no file upload yet). */}
      <Modal
        visible={!!renewModal}
        animationType="slide"
        transparent
        onRequestClose={() => setRenewModal(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRenewModal(null)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Renew {renewModal?.label || 'Document'}
            </Text>
            <Text style={styles.modalHelp}>
              Attach a photo or scan of the renewed document (optional), then
              enter the new expiry date. Your shift unblocks immediately;
              admin will verify the file afterwards.
            </Text>

            {/* Picker buttons */}
            <View style={styles.pickerRow}>
              <TouchableOpacity
                style={styles.pickerBtn}
                activeOpacity={0.85}
                onPress={pickFromCamera}>
                <Icon name="camera" size={18} color="#fff" />
                <Text style={styles.pickerBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pickerBtn}
                activeOpacity={0.85}
                onPress={pickFromGallery}>
                <Icon name="image-multiple" size={18} color="#fff" />
                <Text style={styles.pickerBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>

            {pickedAsset ? (
              <View style={styles.previewRow}>
                <Icon name="file-check" size={18} color="#22c55e" />
                <Text style={styles.previewText} numberOfLines={1}>
                  {pickedAsset.fileName || 'Selected file'}
                  {pickedAsset.fileSize
                    ? ` (${Math.round(pickedAsset.fileSize / 1024)} KB)`
                    : ''}
                </Text>
                <TouchableOpacity onPress={() => setPickedAsset(null)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                  <Icon name="close" size={16} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            ) : null}

            <Text style={styles.formLabel}>New expiry date</Text>
            <TouchableOpacity
              style={[styles.formInput, styles.dateField]}
              activeOpacity={0.85}
              onPress={() => setDatePickerOpen(true)}
            >
              <Icon name="calendar-month" size={16} color="#f5b400" />
              <Text
                style={[
                  styles.dateFieldText,
                  !formExpiry && styles.dateFieldPlaceholder,
                ]}
              >
                {formExpiry
                  ? new Date(formExpiry).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: '2-digit',
                    })
                  : 'Tap to pick a date'}
              </Text>
              <Icon name="chevron-down" size={16} color="#6b7280" />
            </TouchableOpacity>

            <Text style={styles.formLabel}>Document number (optional)</Text>
            <TextInput
              value={formDocNumber}
              onChangeText={setFormDocNumber}
              placeholder="Leave blank to keep existing"
              placeholderTextColor="#6b7280"
              style={styles.formInput}
              autoCapitalize="characters"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setRenewModal(null)}
                activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, !!uploading && { opacity: 0.5 }]}
                onPress={submitRenewal}
                disabled={!!uploading}
                activeOpacity={0.85}>
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Themed date picker — opened from the expiry field in the renewal
          modal. Keeps picker outside the renewal Modal so its own
          backdrop can sit on top without z-index gymnastics. */}
      <ThemedDatePicker
        visible={datePickerOpen}
        value={formExpiry || undefined}
        minDate={new Date()}
        title="New expiry date"
        onCancel={() => setDatePickerOpen(false)}
        onConfirm={(iso) => {
          setFormExpiry(iso);
          setDatePickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent.border,
  },
  backBtn: { width: 30 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  listContent: { padding: 16, paddingBottom: 40 },
  subtitle: { color: Colors.text.secondary, fontSize: 13, marginBottom: 14 },
  card: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(245,180,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  docLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  expiry: { color: Colors.text.secondary, fontSize: 12, marginTop: 2 },
  badge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary[600],
    borderRadius: 10,
    paddingVertical: 10,
    gap: 8,
  },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  footer: { color: Colors.text.muted, fontSize: 12, marginTop: 18, textAlign: 'center' },

  // Renewal modal
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1b2030',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 6 },
  modalHelp: { fontSize: 12, color: '#9ca3af', lineHeight: 18, marginBottom: 16 },
  formLabel: { fontSize: 12, color: '#9ca3af', marginTop: 10, marginBottom: 6 },
  formInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  // The expiry field is a tap target (opens date picker), styled to
  // match formInput so the form reads as consistent.
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  dateFieldText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  dateFieldPlaceholder: {
    color: '#6b7280',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  modalCancelText: { color: '#c7cad1', fontSize: 14, fontWeight: '600' },
  modalSubmit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary[600],
  },
  modalSubmitText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  pickerRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  pickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary[600],
  },
  pickerBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
  },
  previewText: {
    flex: 1,
    fontSize: 12,
    color: '#c7cad1',
  },
});

export default DocumentsScreen;
