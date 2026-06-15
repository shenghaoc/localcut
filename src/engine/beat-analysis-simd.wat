(;; Beat Analysis WASM module -- 1024-point FFT + magnitude.

   JS pre-computes the Hann table and twiddle-factor tables, writes them
   into WASM linear memory before calling the exported function.

   Memory layout (single 64 KiB page):
     0x0000  Hann table         1024 x f32 = 4096 B  (written by JS)
     0x1000  cos twiddle table  512 x f32  = 2048 B  (written by JS, cos(2*pi*k/N))
     0x1800  sin twiddle table  512 x f32  = 2048 B  (written by JS, -sin(2*pi*k/N))
     0x2000  scratch_re         1024 x f32 = 4096 B  (FFT real, in-place)
     0x3000  scratch_im         1024 x f32 = 4096 B  (FFT imaginary)
     0x5000  input buffer       1024 x f32 = 4096 B  (written by JS before call)

   Exported function:
     hann_fft(in_ptr)

   The caller provides:
     in_ptr: 1024 f32 mono audio samples (typically points to 0x5000)

   After return, scratch_re[0..513] contains the magnitudes for bins 0..512.
   JS reads them to compute spectral flux.

   FFT algorithm:
     Decimation-in-time radix-2 with bit-reversal permutation, then
     log2(N)=10 butterfly stages. Twiddle factors are advanced
     incrementally per butterfly using a complex multiply with the
     stage's step twiddle (cosStep, sinStep) -- the same pattern as the
     JS reference (fftInPlace in beat-analysis.ts). Step twiddle for
     stage s with halfSize=2^s is W_N^(N/(2*halfSize)) which lives at
     index N/(2*halfSize) in the (cos, sin) tables; stage 0 with
     halfSize=1 needs no twiddle (always W^0=1+0i) so it short-circuits.
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

  ;; ---- scratch globals for FFT outer loops ----
  (global $stage     (mut i32) (i32.const 0))
  (global $half_size (mut i32) (i32.const 0))
  (global $stride    (mut i32) (i32.const 0))
  (global $k         (mut i32) (i32.const 0))
  (global $j         (mut i32) (i32.const 0))
  (global $i         (mut i32) (i32.const 0))
  (global $t_re      (mut f32) (f32.const 0.0))
  (global $t_im      (mut f32) (f32.const 0.0))

  ;; ---- bit-reversal permutation on scratch_re / scratch_im ----
  (func $bit_reverse
    (local $len i32)

    (global.set $i (i32.const 1))
    (global.set $j (i32.const 0))

    (block $outer_break
      (loop $outer
        (br_if $outer_break (i32.ge_u (global.get $i) (global.get $FFT_N)))

        ;; compute bit-reversed j
        ;; Classic Knuth pattern: while (len > 0 && j >= len) { j -= len; len >>= 1; }
        ;; followed by j += len. Mirrors the j&bit decrement loop in fftInPlace().
        (local.set $len (global.get $HALF_N))
        (block $inner_break
          (loop $inner
            (br_if $inner_break (i32.gt_u (local.get $len) (global.get $j)))
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

  ;; ---- in-place radix-2 DIT FFT, scalar correct implementation ----
  ;; Mirrors fftInPlace() in beat-analysis.ts. Stage 0 (halfSize=1)
  ;; short-circuits since the twiddle is always 1+0i; subsequent stages
  ;; use incremental complex-multiply rotation of the twiddle factor.
  (func $fft
    (local $idx1 i32)
    (local $idx2 i32)
    (local $idx1_off i32)
    (local $idx2_off i32)
    (local $step_idx i32)
    (local $cos_step f32)
    (local $sin_step f32)
    (local $tw_re f32)
    (local $tw_im f32)
    (local $new_tw_re f32)
    (local $t_re_l f32)
    (local $t_im_l f32)
    (local $a_re f32)
    (local $a_im f32)
    (local $b_re f32)
    (local $b_im f32)

    (call $bit_reverse)

    (global.set $half_size (i32.const 1))
    (global.set $stage (i32.const 0))

    (block $stage_break
      (loop $stage_loop
        (br_if $stage_break (i32.ge_u (global.get $stage) (global.get $LOG2_N)))
        (global.set $stride (i32.shl (global.get $half_size) (i32.const 1)))

        (if (i32.eq (global.get $half_size) (i32.const 1))
          (then
            ;; ---- Stage 0: twiddle = 1+0i, no rotation needed ----
            (global.set $k (i32.const 0))
            (block $stage0_break
              (loop $stage0_loop
                (br_if $stage0_break (i32.ge_u (global.get $k) (global.get $FFT_N)))

                (local.set $idx1 (global.get $k))
                (local.set $idx2 (i32.add (global.get $k) (i32.const 1)))
                (local.set $idx1_off (i32.shl (local.get $idx1) (i32.const 2)))
                (local.set $idx2_off (i32.shl (local.get $idx2) (i32.const 2)))

                ;; tRe = re[idx2], tIm = im[idx2]   (twiddle = 1+0i)
                (local.set $t_re_l (f32.load (i32.add (global.get $RE_PTR) (local.get $idx2_off))))
                (local.set $t_im_l (f32.load (i32.add (global.get $IM_PTR) (local.get $idx2_off))))
                ;; b = re[idx1], im[idx1]
                (local.set $b_re (f32.load (i32.add (global.get $RE_PTR) (local.get $idx1_off))))
                (local.set $b_im (f32.load (i32.add (global.get $IM_PTR) (local.get $idx1_off))))

                ;; re[idx2] = re[idx1] - tRe; im[idx2] = im[idx1] - tIm
                (f32.store (i32.add (global.get $RE_PTR) (local.get $idx2_off))
                  (f32.sub (local.get $b_re) (local.get $t_re_l)))
                (f32.store (i32.add (global.get $IM_PTR) (local.get $idx2_off))
                  (f32.sub (local.get $b_im) (local.get $t_im_l)))
                ;; re[idx1] = re[idx1] + tRe; im[idx1] = im[idx1] + tIm
                (f32.store (i32.add (global.get $RE_PTR) (local.get $idx1_off))
                  (f32.add (local.get $b_re) (local.get $t_re_l)))
                (f32.store (i32.add (global.get $IM_PTR) (local.get $idx1_off))
                  (f32.add (local.get $b_im) (local.get $t_im_l)))

                (global.set $k (i32.add (global.get $k) (global.get $stride)))
                (br $stage0_loop)
              )
            )
          )
          (else
            ;; ---- Stages 1..log2N-1: incremental twiddle rotation ----
            ;; cosStep = cos(-PI/halfSize) = COS_PTR[step_idx]   where step_idx = N/(2*halfSize)
            ;; sinStep = sin(-PI/halfSize) = SIN_PTR[step_idx]   (table stores negative sine for forward FFT)
            (local.set $step_idx (i32.shr_u (global.get $FFT_N) (i32.add (global.get $stage) (i32.const 1))))
            (local.set $cos_step (f32.load (i32.add (global.get $COS_PTR) (i32.shl (local.get $step_idx) (i32.const 2)))))
            (local.set $sin_step (f32.load (i32.add (global.get $SIN_PTR) (i32.shl (local.get $step_idx) (i32.const 2)))))

            (global.set $k (i32.const 0))
            (block $k_break
              (loop $k_loop
                (br_if $k_break (i32.ge_u (global.get $k) (global.get $FFT_N)))

                ;; Initial twiddle for this group: (1, 0)
                (local.set $tw_re (f32.const 1.0))
                (local.set $tw_im (f32.const 0.0))

                ;; Inner j-loop: 0..halfSize-1
                (global.set $j (i32.const 0))
                (block $j_break
                  (loop $j_loop
                    (br_if $j_break (i32.ge_u (global.get $j) (global.get $half_size)))

                    (local.set $idx1 (i32.add (global.get $k) (global.get $j)))
                    (local.set $idx2 (i32.add (local.get $idx1) (global.get $half_size)))
                    (local.set $idx1_off (i32.shl (local.get $idx1) (i32.const 2)))
                    (local.set $idx2_off (i32.shl (local.get $idx2) (i32.const 2)))

                    ;; Complex multiply: t = b * tw,  b = re[idx2] + i*im[idx2]
                    (local.set $a_re (f32.load (i32.add (global.get $RE_PTR) (local.get $idx2_off))))
                    (local.set $a_im (f32.load (i32.add (global.get $IM_PTR) (local.get $idx2_off))))
                    (local.set $t_re_l (f32.sub
                      (f32.mul (local.get $a_re) (local.get $tw_re))
                      (f32.mul (local.get $a_im) (local.get $tw_im))))
                    (local.set $t_im_l (f32.add
                      (f32.mul (local.get $a_re) (local.get $tw_im))
                      (f32.mul (local.get $a_im) (local.get $tw_re))))

                    ;; Butterfly: idx1 = idx1 + t, idx2 = idx1 - t
                    (local.set $b_re (f32.load (i32.add (global.get $RE_PTR) (local.get $idx1_off))))
                    (local.set $b_im (f32.load (i32.add (global.get $IM_PTR) (local.get $idx1_off))))

                    (f32.store (i32.add (global.get $RE_PTR) (local.get $idx2_off))
                      (f32.sub (local.get $b_re) (local.get $t_re_l)))
                    (f32.store (i32.add (global.get $IM_PTR) (local.get $idx2_off))
                      (f32.sub (local.get $b_im) (local.get $t_im_l)))
                    (f32.store (i32.add (global.get $RE_PTR) (local.get $idx1_off))
                      (f32.add (local.get $b_re) (local.get $t_re_l)))
                    (f32.store (i32.add (global.get $IM_PTR) (local.get $idx1_off))
                      (f32.add (local.get $b_im) (local.get $t_im_l)))

                    ;; Rotate twiddle: tw' = tw * stepTwiddle
                    ;; newTwRe = twRe*cosStep - twIm*sinStep
                    ;; newTwIm = twRe*sinStep + twIm*cosStep
                    (local.set $new_tw_re (f32.sub
                      (f32.mul (local.get $tw_re) (local.get $cos_step))
                      (f32.mul (local.get $tw_im) (local.get $sin_step))))
                    (local.set $tw_im (f32.add
                      (f32.mul (local.get $tw_re) (local.get $sin_step))
                      (f32.mul (local.get $tw_im) (local.get $cos_step))))
                    (local.set $tw_re (local.get $new_tw_re))

                    (global.set $j (i32.add (global.get $j) (i32.const 1)))
                    (br $j_loop)
                  )
                )

                (global.set $k (i32.add (global.get $k) (global.get $stride)))
                (br $k_loop)
              )
            )
          )
        )

        (global.set $half_size (global.get $stride))
        (global.set $stage (i32.add (global.get $stage) (i32.const 1)))
        (br $stage_loop)
      )
    )
  )

  ;; ---- exported: hann_fft ----
  ;; Applies Hann window, runs in-place FFT, computes magnitudes in scratch_re[0..513].
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

    ;; Step 3: compute magnitudes into scratch_re[0..513]
    ;; mag = sqrt(re^2 + im^2)
    ;; We must read both re and im BEFORE writing to re, otherwise the
    ;; mag stored to re[i] would corrupt the read for the next iteration
    ;; (though here we overwrite re[i] only after using it -- which is fine).
    (global.set $i (i32.const 0))
    (block $mag_break
      (loop $mag_loop
        (br_if $mag_break (i32.ge_u (global.get $i) (global.get $MAG_LEN)))
        (global.set $t_re (f32.load (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2)))))
        (global.set $t_im (f32.load (i32.add (global.get $IM_PTR) (i32.shl (global.get $i) (i32.const 2)))))
        (f32.store
          (i32.add (global.get $RE_PTR) (i32.shl (global.get $i) (i32.const 2)))
          (f32.sqrt
            (f32.add
              (f32.mul (global.get $t_re) (global.get $t_re))
              (f32.mul (global.get $t_im) (global.get $t_im)))))
        (global.set $i (i32.add (global.get $i) (i32.const 1)))
        (br $mag_loop)
      )
    )
    ;; magnitudes are now at RE_PTR[0..512], readable by JS
  )
)
