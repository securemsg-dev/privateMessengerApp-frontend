import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';

export function useVoicePlayback() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const handlePlayVoice = async (messageId: string, uri: string) => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
      if (playingId === messageId) {
        setPlayingId(null);
        return;
      }
    }
    try {
      setPlayingId(messageId);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
          sound.unloadAsync();
          soundRef.current = null;
        }
      });
    } catch {
      setPlayingId(null);
      Alert.alert('Error', 'Could not play this voice message.');
    }
  };

  return { playingId, soundRef, handlePlayVoice };
}
