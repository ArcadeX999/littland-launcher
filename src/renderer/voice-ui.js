// Voice UI: settings section, mic test and the header pill. Uses `$`, `api`, `toast` and `voice`.

const voiceUi = {
  settings: null,
  status: 'off', // off | connecting | connected
  testing: false,
  muted: false,
  deafened: false,
};

function dbToPercent(db) {
  return Math.max(0, Math.min(100, ((db + 80) / 60) * 100)); // -80..-20 dB -> 0..100 %
}

async function saveVoice(patch) {
  voiceUi.settings = { ...voiceUi.settings, ...patch };
  await api.settings.set({ voice: patch });
}

async function fillDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const fill = (select, kind, current) => {
    const list = devices.filter((d) => d.kind === kind);
    select.replaceChildren(
      new Option('Predeterminado del sistema', ''),
      ...list
        .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => new Option(d.label || `${kind === 'audioinput' ? 'Micrófono' : 'Salida'} ${i + 1}`, d.deviceId))
    );
    select.value = list.some((d) => d.deviceId === current) ? current : '';
  };
  fill($('voice-input'), 'audioinput', voiceUi.settings.inputDevice);
  fill($('voice-output'), 'audiooutput', voiceUi.settings.outputDevice);
}

function showThreshold() {
  $('voice-threshold-value').textContent = voiceUi.settings.threshold;
  $('voice-mark').style.left = `${dbToPercent(voiceUi.settings.threshold)}%`;
}

voice.onLevel = (db, talking) => {
  $('voice-meter').style.width = `${dbToPercent(db)}%`;
  $('voice-meter').classList.toggle('talking', talking);
};

async function loadVoiceSettings() {
  voiceUi.settings = (await api.settings.get()).voice;
  const s = voiceUi.settings;
  $('voice-enabled').checked = s.enabled;
  $('voice-threshold').value = s.threshold;
  $('voice-mic').value = s.micGain;
  $('voice-volume').value = s.volume;
  showThreshold();
  await fillDevices();
}

$('btn-settings').addEventListener('click', loadVoiceSettings);
$('voice-enabled').onchange = () => saveVoice({ enabled: $('voice-enabled').checked });
$('voice-input').onchange = async () => {
  await saveVoice({ inputDevice: $('voice-input').value });
  if (voiceUi.testing) startTest();
};
$('voice-output').onchange = async () => {
  await saveVoice({ outputDevice: $('voice-output').value });
  if (voiceUi.testing) startTest();
};
$('voice-threshold').oninput = () => {
  voiceUi.settings.threshold = Number($('voice-threshold').value);
  voice.setThreshold(voiceUi.settings.threshold);
  showThreshold();
};
$('voice-threshold').onchange = () => saveVoice({ threshold: Number($('voice-threshold').value) });
$('voice-mic').oninput = () => voice.setMicGain(Number($('voice-mic').value));
$('voice-mic').onchange = () => saveVoice({ micGain: Number($('voice-mic').value) });
$('voice-volume').oninput = () => voice.setVolume(Number($('voice-volume').value));
$('voice-volume').onchange = () => saveVoice({ volume: Number($('voice-volume').value) });

// ---------------------------------------------------------------- mic test

async function startTest() {
  if (voiceUi.status !== 'off') {
    toast('LA VOZ ESTÁ EN USO EN EL JUEGO');
    return;
  }
  try {
    await voice.start({ settings: { ...voiceUi.settings }, network: false, monitor: true });
    voiceUi.testing = true;
    $('voice-test').classList.add('active');
    $('voice-test').textContent = 'Detener prueba';
    await fillDevices(); // labels become available once the mic was allowed
  } catch (err) {
    toast('NO SE PUDO ABRIR EL MICRÓFONO');
    log(`[Voz] ${err.message}`);
  }
}

async function stopTest() {
  if (!voiceUi.testing) return;
  voiceUi.testing = false;
  $('voice-test').classList.remove('active');
  $('voice-test').textContent = 'Probar micrófono (te oirás a ti mismo)';
  $('voice-meter').style.width = '0';
  await voice.stop();
}

$('voice-test').onclick = () => (voiceUi.testing ? stopTest() : startTest());
$('dlg-settings').addEventListener('close', stopTest);

// ---------------------------------------------------------------- live voice

function renderPill() {
  const pill = $('voice-pill');
  pill.hidden = voiceUi.status === 'off';
  pill.className = 'pill pill-voice';
  if (voiceUi.status === 'connecting') {
    pill.textContent = '🎤 Conectando voz...';
    return;
  }
  const talking = voice.talkingNow();
  if (voiceUi.muted) pill.classList.add('muted');
  else pill.classList.add('connected');
  if (voice.talking || talking.length) pill.classList.add('talking');
  pill.textContent = voiceUi.muted
    ? '🔇 Silenciado'
    : talking.length
      ? `🔊 ${talking.slice(0, 2).join(', ')}${talking.length > 2 ? ` +${talking.length - 2}` : ''}`
      : '🎤 Voz conectada';
}

$('voice-pill').onclick = () => {
  if (voiceUi.status !== 'connected') return;
  voiceUi.muted = !voiceUi.muted;
  voice.muted = voiceUi.muted;
  api.voice.setState({ muted: voiceUi.muted, deafened: voiceUi.deafened });
  renderPill();
};

api.on('voice:status', async ({ state, distance, reason }) => {
  if (reason) log(`[Voz] ${state}: ${reason}`);
  if (state === 'connected') {
    voiceUi.status = 'connected';
    await stopTest();
    if (!voice.running || !voice.network) {
      if (!voiceUi.settings) voiceUi.settings = (await api.settings.get()).voice;
      try {
        await voice.start({ settings: { ...voiceUi.settings }, network: true, distance });
        voice.muted = voiceUi.muted;
      } catch (err) {
        log(`[Voz] No se pudo abrir el micrófono: ${err.message}`);
      }
    }
  } else if (state === 'connecting') {
    voiceUi.status = 'connecting';
  } else {
    voiceUi.status = 'off';
    await voice.stop();
  }
  renderPill();
});

api.on('voice:audio', (packet) => voice.onAudio(packet));
api.on('voice:positions', (p) => voice.onPositions(p));
api.on('voice:speaker', ({ id, name }) => voice.names.set(id >>> 0, name));
api.on('voice:state', ({ muted, deafened }) => {
  voiceUi.muted = muted;
  voiceUi.deafened = deafened;
  voice.muted = muted;
  voice.deafened = deafened;
  renderPill();
});

setInterval(() => {
  if (voiceUi.status === 'connected') renderPill();
}, 250);
