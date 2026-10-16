package app.browsery.android

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/** Marea roles. Full Browsery is the dark "space" look; Chill mode is plain Marea, light or dark. */
data class Pal(
    val void: Int,
    val canvas: Int,
    val surface: Int,
    val surfaceMuted: Int,
    val ink: Int,
    val inkMuted: Int,
    val line: Int,
    val lineStrong: Int,
    val accent: Int,
    val onAccent: Int,
    val accentSoft: Int,
    val accentInk: Int,
    val secondary: Int,
    val secondarySoft: Int,
    val secondaryInk: Int,
    val danger: Int,
    val dark: Boolean,
    val space: Boolean,
) {
    companion object {
        private fun c(hex: String) = Color.parseColor(hex)

        val SPACE = Pal(
            c("#0B100E"), c("#151C19"), c("#1D2722"), c("#26332B"), c("#F1F3EC"), c("#B5C2B7"),
            c("#3D5042"), c("#728979"), c("#F29A80"), c("#301A13"), c("#402923"), c("#FFB8A1"),
            c("#8DD5C0"), c("#203B32"), c("#B2E9D9"), c("#FFADB4"), dark = true, space = true,
        )
        val CHILL_DARK = SPACE.copy(void = c("#151C19"), space = false)
        val CHILL_LIGHT = Pal(
            c("#F7F5F0"), c("#F7F5F0"), c("#FFFFFF"), c("#EEECE5"), c("#202622"), c("#5D6861"),
            c("#D4DAD2"), c("#7D897F"), c("#A63D2F"), c("#FFFFFF"), c("#F7E4DE"), c("#823125"),
            c("#17645D"), c("#DFEEE8"), c("#15564F"), c("#A32A37"), dark = false, space = false,
        )
    }
}

fun alpha(color: Int, a: Float): Int = Color.argb((a * 255).toInt().coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))

fun Context.dp(v: Number): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
fun Context.dpf(v: Number): Float = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics)

fun Context.box(fill: Int, radius: Number, stroke: Int = 0, strokeWidth: Number = 1): GradientDrawable =
    GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dpf(radius)
        if (stroke != 0) setStroke(dp(strokeWidth).coerceAtLeast(1), stroke)
    }

fun Context.grad(colors: IntArray, radius: Number, stroke: Int = 0, orientation: GradientDrawable.Orientation = GradientDrawable.Orientation.TOP_BOTTOM): GradientDrawable =
    GradientDrawable(orientation, colors).apply {
        cornerRadius = dpf(radius)
        if (stroke != 0) setStroke(dp(1).coerceAtLeast(1), stroke)
    }

fun Context.ripple(content: Drawable?, pal: Pal, radius: Number = 12): RippleDrawable =
    RippleDrawable(ColorStateList.valueOf(alpha(pal.ink, 0.14f)), content, box(Color.WHITE, radius))

/** Tinted shadow: a soft coloured glow under raised Browsery surfaces (Android 9+). */
fun View.glow(color: Int, elevationDp: Number) {
    elevation = context.dpf(elevationDp)
    if (android.os.Build.VERSION.SDK_INT >= 28) {
        outlineAmbientShadowColor = color
        outlineSpotShadowColor = color
    }
}

fun Context.label(text: CharSequence, size: Float, color: Int, bold: Boolean = false, family: Typeface = Typeface.SANS_SERIF): TextView =
    TextView(this).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(color)
        typeface = Typeface.create(family, if (bold) Typeface.BOLD else Typeface.NORMAL)
        includeFontPadding = false
    }

fun Context.iconButton(icon: Int, description: String, tint: Int, pal: Pal, size: Number = 48, iconSize: Number = 22, background: Drawable? = null, onClick: (View) -> Unit): ImageButton =
    ImageButton(this).apply {
        setImageResource(icon)
        imageTintList = ColorStateList.valueOf(tint)
        contentDescription = description
        scaleType = ImageView.ScaleType.CENTER_INSIDE
        val pad = ((dp(size) - dp(iconSize)) / 2).coerceAtLeast(0)
        setPadding(pad, pad, pad, pad)
        this.background = ripple(background, pal, 14)
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
        setOnClickListener { v ->
            v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
            onClick(v)
        }
    }

fun Context.row(gravity: Int = Gravity.CENTER_VERTICAL, spacing: Number = 0): LinearLayout =
    LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        this.gravity = gravity
        if (spacing.toFloat() > 0f) {
            showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
            dividerDrawable = GradientDrawable().apply { setSize(dp(spacing), dp(spacing)); setColor(Color.TRANSPARENT) }
        }
    }

fun Context.column(spacing: Number = 0): LinearLayout =
    LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        if (spacing.toFloat() > 0f) {
            showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
            dividerDrawable = GradientDrawable().apply { setSize(dp(spacing), dp(spacing)); setColor(Color.TRANSPARENT) }
        }
    }

fun lp(w: Int, h: Int, weight: Float = 0f): LinearLayout.LayoutParams = LinearLayout.LayoutParams(w, h, weight)
const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

fun LinearLayout.LayoutParams.margins(ctx: Context, l: Number = 0, t: Number = 0, r: Number = 0, b: Number = 0): LinearLayout.LayoutParams =
    apply { setMargins(ctx.dp(l), ctx.dp(t), ctx.dp(r), ctx.dp(b)) }
