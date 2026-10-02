package expo.modules.pathuassistant

import android.content.Context
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.random.Random
import org.tensorflow.lite.Interpreter

/**
 * Pre-trained openWakeWord "hey jarvis" detector (TFLite), a direct port of upstream
 * openwakeword.utils.AudioFeatures streaming + openwakeword.model.Model.predict:
 *   16 kHz PCM16, 80 ms frames (1280 samples)
 *   melspectrogram over the last 1280 + 480 samples, transformed as mel / 10 + 2
 *   embedding over the newest 76 mel frames -> one 96-dim feature per frame
 *   wake model over the last 16 features -> score 0..1 (upstream default threshold 0.5)
 */
class HeyJarvisDetector(context: Context) : Closeable {
  companion object {
    const val SAMPLE_RATE = 16_000
    const val FRAME_SAMPLES = 1280
    const val DEFAULT_THRESHOLD = 0.5f
    private const val MEL_CONTEXT = 160 * 3
    private const val MEL_BINS = 32
    private const val MEL_MAX_FRAMES = 10 * 97
    private const val EMB_WINDOW = 76
    private const val EMB_STEP = 8
    private const val EMB_DIM = 96
    private const val FEATURE_FRAMES = 16
    private const val FEATURE_MAX = 120
    // Upstream Model.predict returns 0 for the first 5 frames after (re)initialisation.
    private const val WARMUP_FRAMES = 5
    private const val MODEL_DIR = "openwakeword"
    private const val WAKE_MODEL = "hey_jarvis_v0.1.tflite"
  }

  private val mel = interpreter(context, "melspectrogram.tflite")
  private val embedding = interpreter(context, "embedding_model.tflite")
  private val wake = interpreter(context, WAKE_MODEL)

  private val raw = FloatArray(FRAME_SAMPLES + MEL_CONTEXT)
  private val melFrames = ArrayDeque<FloatArray>()
  private val features = ArrayDeque<FloatArray>()
  private var melInputSize = -1
  private var framesSinceReset = 0

  private val embIn = floatBuffer(EMB_WINDOW * MEL_BINS)
  private val embOut = floatBuffer(EMB_DIM)
  private val wakeIn = floatBuffer(FEATURE_FRAMES * EMB_DIM)
  private val wakeOut = floatBuffer(1)

  val modelName: String = WAKE_MODEL

  init {
    reset()
  }

  fun reset() {
    raw.fill(0f)
    melFrames.clear()
    repeat(EMB_WINDOW) { melFrames.addLast(FloatArray(MEL_BINS) { 1f }) }
    features.clear()
    val noise = FloatArray(SAMPLE_RATE * 4) { Random.nextInt(-1000, 1000).toFloat() }
    val spec = melspectrogram(noise)
    var i = 0
    while (i + EMB_WINDOW <= spec.size) {
      features.addLast(embed(spec, i))
      i += EMB_STEP
    }
    framesSinceReset = 0
  }

  /** Feeds exactly one 1280-sample frame and returns the wake score for it. */
  fun process(frame: ShortArray): Float {
    require(frame.size == FRAME_SAMPLES) { "frame must be $FRAME_SAMPLES samples" }
    System.arraycopy(raw, FRAME_SAMPLES, raw, 0, MEL_CONTEXT)
    for (i in 0 until FRAME_SAMPLES) raw[MEL_CONTEXT + i] = frame[i].toFloat()

    for (row in melspectrogram(raw)) melFrames.addLast(row)
    while (melFrames.size > MEL_MAX_FRAMES) melFrames.removeFirst()

    features.addLast(embed(melFrames, melFrames.size - EMB_WINDOW))
    while (features.size > FEATURE_MAX) features.removeFirst()

    framesSinceReset += 1
    if (framesSinceReset <= WARMUP_FRAMES) return 0f

    wakeIn.clear()
    for (f in features.size - FEATURE_FRAMES until features.size) {
      for (v in features[f]) wakeIn.putFloat(v)
    }
    wakeIn.rewind()
    wakeOut.clear()
    wake.run(wakeIn, wakeOut)
    wakeOut.rewind()
    return wakeOut.float
  }

  override fun close() {
    mel.close()
    embedding.close()
    wake.close()
  }

  private fun melspectrogram(samples: FloatArray): List<FloatArray> {
    if (melInputSize != samples.size) {
      mel.resizeInput(0, intArrayOf(1, samples.size))
      mel.allocateTensors()
      melInputSize = samples.size
    }
    val input = floatBuffer(samples.size).apply { for (s in samples) putFloat(s); rewind() }
    val outCount = mel.getOutputTensor(0).numElements()
    val output = floatBuffer(outCount)
    mel.run(input, output)
    output.rewind()
    return List(outCount / MEL_BINS) { FloatArray(MEL_BINS) { output.float / 10f + 2f } }
  }

  private fun embed(spec: List<FloatArray>, start: Int): FloatArray {
    embIn.clear()
    for (r in start until start + EMB_WINDOW) {
      for (v in spec[r]) embIn.putFloat(v)
    }
    embIn.rewind()
    embOut.clear()
    embedding.run(embIn, embOut)
    embOut.rewind()
    return FloatArray(EMB_DIM) { embOut.float }
  }

  private fun interpreter(context: Context, name: String): Interpreter {
    val bytes = context.assets.open("$MODEL_DIR/$name").use { it.readBytes() }
    val model = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() }
    return Interpreter(model, Interpreter.Options().setNumThreads(1))
  }

  private fun floatBuffer(count: Int): ByteBuffer =
    ByteBuffer.allocateDirect(count * 4).order(ByteOrder.nativeOrder())
}
