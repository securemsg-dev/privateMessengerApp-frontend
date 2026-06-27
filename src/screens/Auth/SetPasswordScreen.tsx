import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useDispatch, useSelector } from 'react-redux';
import { registerThunk } from '../../store/slices/authSlice';
import { RootState, AppDispatch } from '../../store';
import { useTheme } from '../../theme/ThemeContext';

const MIN_LEN = 8;
const TOTAL_STEPS = 3;
const ON_PRIMARY = '#ffffff';

type Colors = ReturnType<typeof useTheme>['colors'];

/* ─────────────────────────────────────────────────────────────
   Strength scoring — 0..4 (none / weak / fair / good / strong)
   ───────────────────────────────────────────────────────────── */
const scorePassword = (pw: string): { score: number; label: string } => {
  if (pw.length === 0) return { score: 0, label: '' };
  let s = 0;
  if (pw.length >= MIN_LEN) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  s = Math.min(4, s);
  const labels = ['', 'WEAK', 'FAIR', 'GOOD', 'STRONG'];
  return { score: s, label: labels[s] };
};

const strengthColor = (score: number, colors: Colors) => {
  if (score <= 1) return '#e74c3c';
  if (score === 2) return '#e67e22';
  if (score === 3) return '#f1c40f';
  return '#2ecc71';
};

export const SetPasswordScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((s: RootState) => s.auth.status);
  const serverError = useSelector((s: RootState) => s.auth.error);

  const [step, setStep] = useState(1);

  // Step 1
  const [displayName, setDisplayName] = useState('');

  // Step 2
  const [loginPw, setLoginPw] = useState('');
  const [loginPwConfirm, setLoginPwConfirm] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showLoginPwConfirm, setShowLoginPwConfirm] = useState(false);

  // Step 3
  const [deletePw, setDeletePw] = useState('');
  const [deletePwConfirm, setDeletePwConfirm] = useState('');
  const [showDeletePw, setShowDeletePw] = useState(false);
  const [showDeletePwConfirm, setShowDeletePwConfirm] = useState(false);

  const loginStrength = useMemo(() => scorePassword(loginPw), [loginPw]);
  const deleteStrength = useMemo(() => scorePassword(deletePw), [deletePw]);

  const loginOk = loginPw.length >= MIN_LEN && loginPw === loginPwConfirm;
  const deleteOk = deletePw.length >= MIN_LEN && deletePw === deletePwConfirm;
  const passwordsDiffer = loginPw !== deletePw;
  const finalOk = loginOk && deleteOk && passwordsDiffer;

  const canContinue =
    (step === 1) ||
    (step === 2 && loginOk) ||
    (step === 3 && finalOk && status !== 'loading');

  const goNext = async () => {
    if (!canContinue) return;
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }
    // Submit on step 3
    const result = await dispatch(
      registerThunk({
        loginPassword: loginPw,
        deletePassword: deletePw,
        displayName: displayName.trim() || undefined,
      }),
    );
    if (registerThunk.fulfilled.match(result)) {
      navigation.navigate('PrivateNumberReveal');
    }
  };

  const goBack = () => {
    if (step > 1) setStep(step - 1);
    else navigation.goBack();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Top bar: back + progress */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.progressTrack}>
          {[1, 2, 3].map((n) => (
            <View
              key={n}
              style={[
                styles.progressSeg,
                {
                  backgroundColor: n <= step ? colors.primary : colors.border,
                },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.stepCount, { color: colors.textSecondary }]}>
          {step} of {TOTAL_STEPS}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 && (
            <Step1
              colors={colors}
              displayName={displayName}
              setDisplayName={setDisplayName}
            />
          )}

          {step === 2 && (
            <Step2
              colors={colors}
              loginPw={loginPw}
              setLoginPw={setLoginPw}
              loginPwConfirm={loginPwConfirm}
              setLoginPwConfirm={setLoginPwConfirm}
              showLoginPw={showLoginPw}
              toggleShow={() => setShowLoginPw(!showLoginPw)}
              showLoginPwConfirm={showLoginPwConfirm}
              toggleShowConfirm={() => setShowLoginPwConfirm(!showLoginPwConfirm)}
              strength={loginStrength}
              strengthColor={strengthColor(loginStrength.score, colors)}
            />
          )}

          {step === 3 && (
            <Step3
              colors={colors}
              deletePw={deletePw}
              setDeletePw={setDeletePw}
              deletePwConfirm={deletePwConfirm}
              setDeletePwConfirm={setDeletePwConfirm}
              showDeletePw={showDeletePw}
              toggleShow={() => setShowDeletePw(!showDeletePw)}
              showDeletePwConfirm={showDeletePwConfirm}
              toggleShowConfirm={() => setShowDeletePwConfirm(!showDeletePwConfirm)}
              strength={deleteStrength}
              strengthColor={strengthColor(deleteStrength.score, colors)}
              clashes={!passwordsDiffer && deletePw.length > 0}
            />
          )}

          {serverError && step === 3 && (
            <Text style={styles.serverError}>{serverError}</Text>
          )}
        </ScrollView>

        {/* Continue button — fixed at bottom */}
        <View
          style={[
            styles.btnBar,
            { backgroundColor: colors.background, borderTopColor: colors.border },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.continueBtn,
              { backgroundColor: canContinue ? colors.primary : colors.border },
            ]}
            onPress={goNext}
            disabled={!canContinue}
            activeOpacity={0.85}
          >
            {status === 'loading' && step === 3 ? (
              <ActivityIndicator color={ON_PRIMARY} />
            ) : (
              <>
                <Text
                  style={[
                    styles.continueBtnText,
                    { color: canContinue ? ON_PRIMARY : colors.textSecondary },
                  ]}
                >
                  {step === TOTAL_STEPS ? 'Create account' : 'Continue'}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={20}
                  color={canContinue ? ON_PRIMARY : colors.textSecondary}
                />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

/* ─────────────────────────────────────────────────────────────
   Step 1 — Identity
   ───────────────────────────────────────────────────────────── */
const Step1 = ({
  colors,
  displayName,
  setDisplayName,
}: {
  colors: Colors;
  displayName: string;
  setDisplayName: (v: string) => void;
}) => (
  <View>
    <Text style={[styles.stepKicker, { color: colors.textSecondary }]}>
      STEP 1 — IDENTITY
    </Text>
    <Text style={[styles.heading, { color: colors.text }]}>
      What should{'\n'}we call you?
    </Text>
    <Text style={[styles.subhead, { color: colors.textSecondary }]}>
      Optional. Only people you chat with see this — we never share it.
    </Text>

    <View
      style={[
        styles.inputWrap,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons
        name="person-outline"
        size={18}
        color={colors.textSecondary}
        style={{ marginRight: 8 }}
      />
      <TextInput
        style={[styles.textInput, { color: colors.text }]}
        placeholder="e.g. Alex"
        placeholderTextColor={colors.textSecondary}
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        returnKeyType="next"
        autoFocus
      />
    </View>

    <View
      style={[
        styles.infoCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoTitle, { color: colors.text }]}>
          Your private number is automatic
        </Text>
        <Text style={[styles.infoBody, { color: colors.textSecondary }]}>
          We'll generate a 10-digit number after you finish setting up. No phone, no email.
        </Text>
      </View>
    </View>
  </View>
);

/* ─────────────────────────────────────────────────────────────
   Step 2 — Login password
   ───────────────────────────────────────────────────────────── */
const Step2 = ({
  colors,
  loginPw,
  setLoginPw,
  loginPwConfirm,
  setLoginPwConfirm,
  showLoginPw,
  toggleShow,
  showLoginPwConfirm,
  toggleShowConfirm,
  strength,
  strengthColor,
}: {
  colors: Colors;
  loginPw: string;
  setLoginPw: (v: string) => void;
  loginPwConfirm: string;
  setLoginPwConfirm: (v: string) => void;
  showLoginPw: boolean;
  toggleShow: () => void;
  showLoginPwConfirm: boolean;
  toggleShowConfirm: () => void;
  strength: { score: number; label: string };
  strengthColor: string;
}) => {
  const mismatch = loginPwConfirm.length > 0 && loginPw !== loginPwConfirm;
  return (
    <View>
      <Text style={[styles.stepKicker, { color: colors.textSecondary }]}>
        STEP 2 — SECURITY
      </Text>
      <Text style={[styles.heading, { color: colors.text }]}>Set a login password.</Text>
      <Text style={[styles.subhead, { color: colors.textSecondary }]}>
        Eight characters or more. This is how you sign back in — we can't reset it.
      </Text>

      <PasswordField
        colors={colors}
        placeholder="Password"
        value={loginPw}
        onChangeText={setLoginPw}
        show={showLoginPw}
        onToggleShow={toggleShow}
      />
      <PasswordField
        colors={colors}
        placeholder="Confirm password"
        value={loginPwConfirm}
        onChangeText={setLoginPwConfirm}
        show={showLoginPwConfirm}
        onToggleShow={toggleShowConfirm}
      />

      {/* Strength bar */}
      {loginPw.length > 0 && (
        <View style={styles.strengthRow}>
          <View style={[styles.strengthBar, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.strengthFill,
                {
                  width: `${(strength.score / 4) * 100}%`,
                  backgroundColor: strengthColor,
                },
              ]}
            />
          </View>
          <Text style={[styles.strengthLabel, { color: strengthColor }]}>
            {strength.label}
          </Text>
        </View>
      )}

      {mismatch && (
        <View style={styles.errorRow}>
          <Ionicons name="close-circle" size={14} color="#e74c3c" />
          <Text style={styles.errorText}>Passwords don't match</Text>
        </View>
      )}

      {/* Defer-delete-pw card */}
      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Ionicons name="shield-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.infoTitle, { color: colors.text }]}>
            Delete-password next
          </Text>
          <Text style={[styles.infoBody, { color: colors.textSecondary }]}>
            On the next step we'll set a separate, single-use password for account deletion. One
            screen, one decision.
          </Text>
        </View>
      </View>
    </View>
  );
};

/* ─────────────────────────────────────────────────────────────
   Step 3 — Delete-account password
   ───────────────────────────────────────────────────────────── */
const Step3 = ({
  colors,
  deletePw,
  setDeletePw,
  deletePwConfirm,
  setDeletePwConfirm,
  showDeletePw,
  toggleShow,
  showDeletePwConfirm,
  toggleShowConfirm,
  strength,
  strengthColor,
  clashes,
}: {
  colors: Colors;
  deletePw: string;
  setDeletePw: (v: string) => void;
  deletePwConfirm: string;
  setDeletePwConfirm: (v: string) => void;
  showDeletePw: boolean;
  toggleShow: () => void;
  showDeletePwConfirm: boolean;
  toggleShowConfirm: () => void;
  strength: { score: number; label: string };
  strengthColor: string;
  clashes: boolean;
}) => {
  const mismatch = deletePwConfirm.length > 0 && deletePw !== deletePwConfirm;
  return (
    <View>
      <Text style={[styles.stepKicker, { color: colors.textSecondary }]}>
        STEP 3 — SAFETY NET
      </Text>
      <Text style={[styles.heading, { color: colors.text }]}>
        Set a delete{'\n'}password.
      </Text>
      <Text style={[styles.subhead, { color: colors.textSecondary }]}>
        Used only when erasing your account. Must differ from your login password.
      </Text>

      <PasswordField
        colors={colors}
        placeholder="Delete password"
        value={deletePw}
        onChangeText={setDeletePw}
        show={showDeletePw}
        onToggleShow={toggleShow}
      />
      <PasswordField
        colors={colors}
        placeholder="Confirm delete password"
        value={deletePwConfirm}
        onChangeText={setDeletePwConfirm}
        show={showDeletePwConfirm}
        onToggleShow={toggleShowConfirm}
      />

      {deletePw.length > 0 && (
        <View style={styles.strengthRow}>
          <View style={[styles.strengthBar, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.strengthFill,
                {
                  width: `${(strength.score / 4) * 100}%`,
                  backgroundColor: strengthColor,
                },
              ]}
            />
          </View>
          <Text style={[styles.strengthLabel, { color: strengthColor }]}>
            {strength.label}
          </Text>
        </View>
      )}

      {mismatch && (
        <View style={styles.errorRow}>
          <Ionicons name="close-circle" size={14} color="#e74c3c" />
          <Text style={styles.errorText}>Passwords don't match</Text>
        </View>
      )}
      {clashes && !mismatch && (
        <View style={styles.errorRow}>
          <Ionicons name="close-circle" size={14} color="#e74c3c" />
          <Text style={styles.errorText}>Must differ from your login password</Text>
        </View>
      )}

      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Ionicons name="warning-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.infoTitle, { color: colors.text }]}>
            One-tap account wipe
          </Text>
          <Text style={[styles.infoBody, { color: colors.textSecondary }]}>
            Entering this password on the lock screen instantly erases your account and local data
            — no dialog.
          </Text>
        </View>
      </View>
    </View>
  );
};

/* ─────────────────────────────────────────────────────────────
   Shared password field
   ───────────────────────────────────────────────────────────── */
const PasswordField = ({
  colors,
  placeholder,
  value,
  onChangeText,
  show,
  onToggleShow,
}: {
  colors: Colors;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  show: boolean;
  onToggleShow: () => void;
}) => (
  <View
    style={[
      styles.inputWrap,
      { backgroundColor: colors.surface, borderColor: colors.border },
    ]}
  >
    <Ionicons
      name="lock-closed-outline"
      size={18}
      color={colors.textSecondary}
      style={{ marginRight: 8 }}
    />
    <TextInput
      style={[styles.textInput, { color: colors.text }]}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      secureTextEntry={!show}
      keyboardType="number-pad"
      value={value}
      onChangeText={onChangeText}
    />
    <TouchableOpacity onPress={onToggleShow} style={styles.eyeBtn}>
      <Ionicons
        name={show ? 'eye-off-outline' : 'eye-outline'}
        size={20}
        color={colors.textSecondary}
      />
    </TouchableOpacity>
  </View>
);

/* ─────────────────────────────────────────────────────────────
   Styles
   ───────────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },

  /* Top bar */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: { padding: 4 },
  progressTrack: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  progressSeg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  stepCount: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    minWidth: 44,
    textAlign: 'right',
  },

  /* Content */
  scrollContent: { paddingHorizontal: 24, paddingBottom: 24 },
  stepKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  heading: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 36,
    marginBottom: 12,
  },
  subhead: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },

  /* Input */
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  textInput: { flex: 1, fontSize: 16, paddingVertical: 14 },
  eyeBtn: { padding: 6 },

  /* Strength bar */
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
    gap: 12,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthFill: { height: '100%', borderRadius: 2 },
  strengthLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    minWidth: 56,
    textAlign: 'right',
  },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  errorText: { fontSize: 13, color: '#e74c3c' },

  /* Info card */
  infoCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  infoTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  infoBody: { fontSize: 13, lineHeight: 19 },

  serverError: {
    fontSize: 14,
    color: '#e74c3c',
    textAlign: 'center',
    marginTop: 16,
  },

  /* Bottom button bar */
  btnBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 28,
    paddingVertical: 17,
    paddingHorizontal: 24,
  },
  continueBtnText: { fontSize: 16, fontWeight: '700' },
});
