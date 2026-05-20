import { Dimensions, Platform, StyleSheet } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const BUBBLE_MAX_WIDTH = SCREEN_WIDTH * 0.74;
export const ON_PRIMARY = '#ffffff';

export const styles = StyleSheet.create({
  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 6 },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginLeft: 2,
  },
  headerAvatarText: { fontSize: 12, fontWeight: '700' },
  headerInfo: { flex: 1, marginLeft: 10 },
  headerName: { fontSize: 16, fontWeight: '700' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  presenceDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  headerSub: { fontSize: 11, fontWeight: '500', letterSpacing: 0.5 },
  headerIcon: { padding: 8 },

  /* Messages */
  messageList: { paddingHorizontal: 14, paddingVertical: 10 },
  bubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginVertical: 1,
  },
  bubbleTailSent: { borderBottomRightRadius: 6 },
  bubbleTailReceived: { borderBottomLeftRadius: 6 },
  mediaBubbleContainer: { padding: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },

  /* Per-bubble meta line */
  metaRow: { paddingHorizontal: 4, marginTop: 2, marginBottom: 6 },
  metaLeft: { alignItems: 'flex-start' },
  metaRight: { alignItems: 'flex-end' },
  metaText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.6 },

  /* Reaction badges */
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
    marginTop: 4,
    gap: 4,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 26,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 6,
    gap: 3,
  },
  reactionBadgeText: { fontSize: 13 },
  reactionCount: { fontSize: 11, fontWeight: '700' },

  /* Tombstone for delete-for-everyone messages */
  bubbleTombstone: { fontSize: 14, fontStyle: 'italic', lineHeight: 19 },

  /* Reply quote inside a bubble */
  replyQuote: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 4,
    borderLeftWidth: 3,
    borderRadius: 4,
    marginBottom: 6,
  },
  replyQuoteAuthor: { fontSize: 11, fontWeight: '700', marginBottom: 1 },
  replyQuoteText: { fontSize: 12, lineHeight: 16 },

  /* Day separator */
  dayWrap: { alignItems: 'center', marginVertical: 14 },
  dayLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  /* Image / Video */
  mediaBubbleImage: {
    width: BUBBLE_MAX_WIDTH - 8,
    height: (BUBBLE_MAX_WIDTH - 8) * 0.75,
    borderRadius: 16,
  },
  videoBubble: { position: 'relative' },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
  },

  /* Voice */
  voiceBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 170,
  },
  voicePlayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 26,
  },
  waveBar: { width: 2.5, borderRadius: 2 },
  voiceDuration: { fontSize: 11, fontWeight: '600', minWidth: 32 },

  /* Info card (self chat) */
  infoCard: {
    alignSelf: 'center',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 16,
    maxWidth: 280,
    gap: 12,
  },
  infoCardText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  /* Composer */
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    minHeight: 42,
    maxHeight: 110,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
    paddingTop: Platform.OS === 'android' ? 4 : 0,
    paddingHorizontal: 6,
  },
  inlineBtn: { padding: 6, justifyContent: 'center' },
  inlineBtnLeft: { padding: 6, justifyContent: 'center' },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Recording bar */
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
    minHeight: 56,
  },
  trashBtn: { padding: 8 },
  recLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recDot: { width: 9, height: 9, borderRadius: 5 },
  recTimer: { fontSize: 13, fontWeight: '700', minWidth: 36, fontVariant: ['tabular-nums'] },
  waveformLive: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 28,
    paddingHorizontal: 6,
  },
  waveBarLive: { width: 2.5, borderRadius: 2 },
  slideHint: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 8 },
  slideHintText: { fontSize: 12, fontWeight: '500' },

  /* Preview bar */
  previewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    minHeight: 56,
  },
  previewBubble: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: 1,
  },
  previewPlayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewDurText: {
    fontSize: 12,
    fontWeight: '600',
    minWidth: 32,
    fontVariant: ['tabular-nums'],
  },
  previewSendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
