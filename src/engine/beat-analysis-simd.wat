(;; Beat Analysis SIMD module -- 1024-point FFT + magnitude

   JS pre-computes the Hann table and twiddle-factor tables, writes them
   into WASM linear memory before calling the exported function.

   Memory layout (single 64 KiB page):
     0x0000  Hann table         1024 x f32 = 4096 B  (written by JS)
     0x1000  cos twiddle table  512 x f32  = 2048 B  (written by JS)
     0x1800  sin twiddle table  512 x f32  = 2048 B  (written by JS)
     0x2000  scratch_re         1024 x f32 = 4096 B  (FFT real, in-place)
     0x3000  scratch_im         1024 x f32 = 4096 B  (FFT imaginary)
     0x5000  input buffer       1024 x f32 = 4096 B  (written by JS before call)

   Exported function:
     hann_fft(in_ptr)

   The caller provides:
     in_ptr: 1024 f32 mono audio samples (typically points to 0x5000)

   After return, scratch_re[0..512] contains the magnitudes for bins 0..512.
   JS reads them to compute spectral flux.
 ;)

(module
  ;; Single 64 KiB page of linear memory
  (memory (export "memory") 1 1)

  ;; ---- memory layout constants ----
  (global $HANN_PTR i32 (i32.const 0))     ;; 0x0000  (written by JS before call)
  (global $COS_PTR  i32 (i32.const 4096))  ;; 0x1000  (written by JS before call)
  (global $SIN_PTR  i32 (i32.const 6144))  ;; 0x1800  (written by JS before call)
  (global $RE_PTR   i32 (i32.const 8192))  ;; 0x2000  (FFT real part, in-place)
  (global $IM_PTR   i32 (i32.const 12288)) ;; 0x3000  (FFT imaginary part)

  (global $FFT_N    i32 (i32.const 1024))
  (global $HALF_N   i32 (i32.const 512))
  (global $LOG2_N   i32 (i32.const 10))
  (global $MAG_LEN  i32 (i32.const 513))
  (global $IN_BUF   i32 (i32.const 20480)) ;; 0x5000  (input buffer for JS to write samples)

  ;; ---- scratch globals for FFT ----
  (global $stage     (mut i32) (i32.const 0))
  (global $half_size (mut i32) (i32.const 0))
  (global $stride    (mut i32) (i32.const 0))
  (global $k         (mut i32) (i32.const 0))
  (global $j         (mut i32) (i32.const 0))
  (global $tw_idx    (mut i32) (i32.const 0))
  (global $tw_re     (mut f32) (f32.const 0.0))
  (global $tw_im     (mut f32) (f32.const 0.0))
  (global $i         (mut i32) (i32.const 0))
  (global $t_re      (mut f32) (f32.const 0.0))
  (global $t_im      (mut f32) (f32.const 0.0))

  ;; ---- bit-reversal permutation on scratch_re / scratch_im ----
  (func $bit_reverse
    (local $len i32)
    (local $rev i32)
    (local $bits i32)

    (global.set $i (i32.const 1))
    (global.set $j (i32.const 0))

    (block $outer_break
      (loop $outer
        (br_if $outer_break (i32.ge_u (global.get $i) (global.get $FFT_N)))

        ;; compute bit-reversed j
        (local.set $len (global.get $HALF_N))
        (block $inner_break
          (loop $inner
            (br_if $inner_break (i32.le_u (local.get $len) (global.get $j)))
            (global.set $j (i32.sub (global.get $j) (local.get $len)))
            (local.set $len (i32.shr_u (local.get $len) (i32.const 1)))
            (br $inner)
          )
        )
        (global.set $j (i32.add (global.get $j) (local.get $len)))

        (if (i32.lt_u (global.get $j) (global.get $i))
          (then
            ;; swap re[i] <-> re[j]
            (global.set $t_re (f32.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2)))))
            (f32.store (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2)))
              (f32.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $j) (i32.const 2)))))
            (f32.store (i32.add (global.get $RE_PTR) (i32.shl (global.get $j) (i32.const 2)))
              (global.get $t_re))
            ;; swap im[i] <-> im[j]
            (global.set $t_im (f32.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $i) (i32.const 2)))))
            (f32.store (i32.add (global.get $IM_PTR) (i32.shl (global.get $i) (i32.const 2)))
              (f32.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $j) (i32.const 2)))))
            (f32.store (i32.add (global.get $IM_PTR) (i32.shl (global.get $j) (i32.const 2)))
              (global.get $t_im))
          )
        )

        (global.set $i (i32.add (global.get $i) (i32.const 1)))
        (br $outer)
      )
    )
  )

  ;; ---- in-place radix-2 FFT with f32x4 SIMD butterfly ----
  (func $fft
    (local $tw4 v128)
    (local $a_re v128)
    (local $a_im v128)
    (local $b_re v128)
    (local $b_im v128)
    (local $new_b_re v128)
    (local $new_b_im v128)

    (call $bit_reverse)

    (global.set $half_size (i32.const 1))
    (global.set $stage (i32.const 0))

    (block $stage_break
      (loop $stage_loop
        (br_if $stage_break (i32.ge_u (global.get $stage) (global.get $LOG2_N)))
        (global.set $stride (i32.shl (global.get $half_size) (i32.const 1)))
        (global.set $k (i32.const 0))

        (block $k_break
          (loop $k_loop
            (br_if $k_break (i32.ge_u (global.get $k) (global.get $FFT_N)))

            ;; broadcast twiddle factor for this group
            (global.set $tw_idx (i32.shr_u (global.get $k) (global.get $stage)))
            (local.set $tw4 (f32x4.splat
              (f32.load (i32.add (global.get $COS_PTR) (i32.shl (global.get $tw_idx) (i32.const 2))))))
            (global.set $tw_re (f32.load
              (i32.add (global.get $SIN_PTR) (i32.shl (global.get $tw_idx) (i32.const 2)))))

            ;; butterflies: 4 at a time via f32x4 SIMD
            (global.set $j (global.get $k))
            (block $j_break
              (loop $j_loop
                (br_if $j_break (i32.ge_u
                  (i32.add (global.get $j) (i32.const 4))
                  (i32.add (global.get $k) (global.get $half_size))))

                ;; a = re[j..j+3], im[j..j+3]
                (local.set $a_re (v128.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $j) (i32.const 2)))))
                (local.set $a_im (v128.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $j) (i32.const 2)))))
                ;; b = re[j+hs..j+hs+3], im[j+hs..j+hs+3]
                (local.set $b_re (v128.load (i32.add (global.get $RE_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))))
                (local.set $b_im (v128.load (i32.add (global.get $IM_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))))

                ;; complex multiply: b * tw
                ;; new_b_re = b_re * tw_re - b_im * tw_im
                (local.set $new_b_re (f32x4.sub
                  (f32x4.mul (local.get $b_re) (local.get $tw4))
                  (f32x4.mul (local.get $b_im) (f32x4.splat (global.get $tw_re)))))
                ;; new_b_im = b_re * tw_im + b_im * tw_re
                (local.set $new_b_im (f32x4.add
                  (f32x4.mul (local.get $b_re) (f32x4.splat (global.get $tw_re)))
                  (f32x4.mul (local.get $b_im) (local.get $tw4))))

                ;; butterfly: a' = a + b', b'' = a - b'
                (v128.store (i32.add (global.get $RE_PTR) (i32.shl (global.get $j) (i32.const 2)))
                  (f32x4.add (local.get $a_re) (local.get $new_b_re)))
                (v128.store (i32.add (global.get $IM_PTR) (i32.shl (global.get $j) (i32.const 2)))
                  (f32x4.add (local.get $a_im) (local.get $new_b_im)))
                (v128.store (i32.add (global.get $RE_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))
                  (f32x4.sub (local.get $a_re) (local.get $new_b_re)))
                (v128.store (i32.add (global.get $IM_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))
                  (f32x4.sub (local.get $a_im) (local.get $new_b_im)))

                (global.set $j (i32.add (global.get $j) (i32.const 4)))
                (br $j_loop)
              )
            )

            ;; scalar tail for remaining butterflies
            (block $tail_break
              (loop $tail_loop
                (br_if $tail_break (i32.ge_u (global.get $j) (i32.add (global.get $k) (global.get $half_size))))

                (global.set $t_re (f32.load (i32.add (global.get $RE_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))))
                (global.set $t_im (f32.load (i32.add (global.get $IM_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))))
                (global.set $t_re
                  (f32.sub (f32.mul (global.get $t_re) (f32.load (i32.add (global.get $COS_PTR) (i32.shl (global.get $tw_idx) (i32.const 2)))))
                           (f32.mul (global.get $t_im) (global.get $tw_re))))
                (global.set $t_im
                  (f32.add (f32.mul (f32.load (i32.add (global.get $RE_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))) (global.get $tw_re))
                           (f32.mul (f32.load (i32.add (global.get $IM_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))) (f32.load (i32.add (global.get $COS_PTR) (i32.shl (global.get $tw_idx) (i32.const 2)))))))

                (f32.store (i32.add (global.get $RE_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))
                  (f32.sub (f32.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $j) (i32.const 2)))) (global.get $t_re)))
                (f32.store (i32.add (global.get $IM_PTR) (i32.shl (i32.add (global.get $j) (global.get $half_size)) (i32.const 2)))
                  (f32.sub (f32.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $j) (i32.const 2)))) (global.get $t_im)))
                (f32.store (i32.add (global.get $RE_PTR) (i32.shl (global.get $j) (i32.const 2)))
                  (f32.add (f32.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $j) (i32.const 2)))) (global.get $t_re)))
                (f32.store (i32.add (global.get $IM_PTR) (i32.shl (global.get $j) (i32.const 2)))
                  (f32.add (f32.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $j) (i32.const 2)))) (global.get $t_im)))

                (global.set $j (i32.add (global.get $j) (i32.const 1)))
                (br $tail_loop)
              )
            )

            (global.set $k (i32.add (global.get $k) (global.get $stride)))
            (br $k_loop)
          )
        )

        (global.set $half_size (global.get $stride))
        (global.set $stage (i32.add (global.get $stage) (i32.const 1)))
        (br $stage_loop)
      )
    )
  )

  ;; ---- exported: hann_fft ----
  ;; Applies Hann window, runs in-place FFT, computes magnitudes in scratch_re[0..512].
  ;; JS must pre-write Hann table at 0x0000 and twiddle tables at 0x1000/0x1800.
  (func $hann_fft (export "hann_fft") (param $in_ptr i32)

    ;; Step 1: apply Hann window into scratch_re, zero scratch_im
    (global.set $i (i32.const 0))
    (block $copy_break
      (loop $copy_loop
        (br_if $copy_break (i32.ge_u (global.get $i) (global.get $FFT_N)))
        (f32.store
          (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2)))
          (f32.mul
            (f32.load (i32.add (local.get $in_ptr) (i32.shl (global.get $i) (i32.const 2))))
            (f32.load (i32.add (global.get $HANN_PTR) (i32.shl (global.get $i) (i32.const 2))))))
        (f32.store
          (i32.add (global.get $IM_PTR) (i32.shl (global.get $i) (i32.const 2)))
          (f32.const 0.0))
        (global.set $i (i32.add (global.get $i) (i32.const 1)))
        (br $copy_loop)
      )
    )

    ;; Step 2: in-place FFT (writes scratch_re and scratch_im)
    (call $fft)

    ;; Step 3: compute magnitudes into scratch_re[0..512]
    ;; mag = sqrt(re^2 + im^2)
    (global.set $i (i32.const 0))
    (block $mag_break
      (loop $mag_loop
        (br_if $mag_break (i32.ge_u (global.get $i) (global.get $MAG_LEN)))
        (f32.store
          (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2)))
          (f32.sqrt
            (f32.add
              (f32.mul
                (f32.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2))))
                (f32.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2)))))
              (f32.mul
                (f32.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $i) (i32.const 2))))
                (f32.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $i) (i32.const 2))))))))
        (global.set $i (i32.add (global.get $i) (i32.const 1)))
        (br $mag_loop)
      )
    )
    ;; magnitudes are now at RE_PTR[0..512], readable by JS
  )
)
