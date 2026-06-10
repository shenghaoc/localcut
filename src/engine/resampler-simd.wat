;; Polyphase sinc resampler inner loop with wasm-simd128 intrinsics.
;; Implements the same streaming contract as the JS AudioResampler.process().
;; Memory layout is caller-managed.
;;
;; Compiled to resampler-simd.wasm + resampler-simd-wasm-b64.ts via npm run build:wasm (wabt).

(module
  (memory (export "memory") 1)

  (global $filterTablePtr (mut i32) (i32.const 0))
  (global $filterSize     (mut i32) (i32.const 16))
  (global $tablePoints    (mut i32) (i32.const 512))
  (global $channels       (mut i32) (i32.const 1))
  (global $ratio          (mut f64) (f64.const 1.0))
  (global $halfFilter     (mut f64) (f64.const 7.5))
  (global $halfFilterInt  (mut i32) (i32.const 7))
  (global $historyFilled  (mut i32) (i32.const 0))
  (global $inputFraction  (mut f64) (f64.const 0.0))
  (export "historyFilled"  (global $historyFilled))
(export "inputFraction"  (global $inputFraction))
(export "filterSize"     (global $filterSize))
(export "channels"       (global $channels))

  (func $min_i32 (param $a i32) (param $b i32) (result i32)
    (select (local.get $a) (local.get $b) (i32.lt_s (local.get $a) (local.get $b))))

  (func (export "init")
    (param $ftPtr i32) (param $fs i32) (param $tp i32)
    (param $inRate f64) (param $outRate f64) (param $ch i32)
    (global.set $filterTablePtr (local.get $ftPtr))
    (global.set $filterSize     (local.get $fs))
    (global.set $tablePoints    (local.get $tp))
    (global.set $channels       (local.get $ch))
    (global.set $ratio (f64.div (local.get $inRate) (local.get $outRate)))
    (global.set $halfFilter
      (f64.mul (f64.convert_i32_s (i32.sub (local.get $fs) (i32.const 1))) (f64.const 0.5)))
    (global.set $halfFilterInt (i32.trunc_f64_s (global.get $halfFilter)))
    (global.set $historyFilled (i32.const 0))
    (global.set $inputFraction (f64.const 0.0)))

  (func (export "reset")
    (global.set $historyFilled (i32.const 0))
    (global.set $inputFraction (f64.const 0.0)))

  (func $process (export "process")
    (param $inputPtr i32) (param $inputFrames i32) (param $outputPtr i32)
    (result i32)
    (local $fs i32) (local $ch i32) (local $tp i32)
    (local $hfi i32) (local $hf f64) (local $ftPtr i32)
    (local $totalFrames i32) (local $srcPos f64) (local $writeIdx i32)
    (local $center f64) (local $intCenter i32) (local $frac f64)
    (local $phaseIdx i32) (local $filterRow i32) (local $sampleBase i32)
    (local $c i32) (local $tap i32)
    (local $simdIters i32) (local $simdLimit i32)
    (local $simdAcc v128) (local $fCoefs v128) (local $samples v128)
    (local $sum f64) (local $consume i32) (local $remStart i32)
    (local $sIdx i32) (local $chBytes i32)
    (local $t1 i32) (local $t2 i32) (local $t3 i32) (local $chanBaseBytePtr i32)

    (local.set $fs (global.get $filterSize))
    (local.set $ch (global.get $channels))
    (local.set $tp (global.get $tablePoints))
    (local.set $hfi (global.get $halfFilterInt))
    (local.set $hf (global.get $halfFilter))
    (local.set $ftPtr (global.get $filterTablePtr))
    (local.set $totalFrames (i32.add (global.get $historyFilled) (local.get $inputFrames)))
    (local.set $srcPos (global.get $inputFraction))
    (local.set $writeIdx (i32.const 0))
    (local.set $chBytes (i32.shl (local.get $ch) (i32.const 2)))

    ;; $simdIters/$simdLimit depend only on filterSize (constant per process() call)
    (local.set $simdIters (i32.div_u (local.get $fs) (i32.const 4)))
    (local.set $simdLimit (i32.mul (local.get $simdIters) (i32.const 4)))

    (block $done
      (loop $outer
        (local.set $center (f64.add (local.get $srcPos) (local.get $hf)))
        (local.set $intCenter (i32.trunc_f64_s (local.get $center)))
        (br_if $done
          (i32.gt_u
            (i32.add (i32.sub (local.get $intCenter) (local.get $hfi)) (local.get $fs))
            (local.get $totalFrames)))
        (local.set $frac (f64.sub (local.get $center) (f64.convert_i32_s (local.get $intCenter))))
        (local.set $phaseIdx (i32.trunc_f64_s (f64.mul (local.get $frac) (f64.convert_i32_s (local.get $tp)))))
        (local.set $phaseIdx (call $min_i32 (local.get $phaseIdx) (i32.sub (local.get $tp) (i32.const 1))))
        (local.set $filterRow (i32.mul (local.get $phaseIdx) (local.get $fs)))
        (local.set $sampleBase (i32.mul (i32.sub (local.get $intCenter) (local.get $hfi)) (local.get $ch)))

        (local.set $c (i32.const 0))
        (block $chanDone
          (loop $chanLoop
            (br_if $chanDone (i32.ge_u (local.get $c) (local.get $ch)))
            (local.set $simdAcc (v128.const i32x4 0 0 0 0))
            (local.set $tap (i32.const 0))
            (local.set $chanBaseBytePtr
              (i32.add (local.get $inputPtr)
                (i32.shl (i32.add (local.get $sampleBase) (local.get $c)) (i32.const 2))))

            (if (i32.eq (local.get $ch) (i32.const 1))
              (then
                (block $simdMonoDone
                  (loop $simdMonoLoop
                    (br_if $simdMonoDone
                      (i32.ge_u (local.get $tap) (local.get $simdLimit)))
                    (local.set $fCoefs
                      (v128.load (i32.add (local.get $ftPtr)
                        (i32.shl (i32.add (local.get $filterRow) (local.get $tap)) (i32.const 2)))))
                    (local.set $samples
                      (v128.load (i32.add (local.get $inputPtr)
                        (i32.shl (i32.add (local.get $sampleBase) (local.get $tap)) (i32.const 2)))))
                    (local.set $simdAcc (f32x4.add (local.get $simdAcc)
                      (f32x4.mul (local.get $samples) (local.get $fCoefs))))
                    (local.set $tap (i32.add (local.get $tap) (i32.const 4)))
                    (br $simdMonoLoop))))
              (else
                (block $simdMultiDone
                  (loop $simdMultiLoop
                    (br_if $simdMultiDone
                      (i32.ge_u (local.get $tap) (local.get $simdLimit)))
                    (local.set $fCoefs
                      (v128.load (i32.add (local.get $ftPtr)
                        (i32.shl (i32.add (local.get $filterRow) (local.get $tap)) (i32.const 2)))))
                    (local.set $samples
                      (v128.load32_lane 0
                        (i32.add (local.get $chanBaseBytePtr)
                          (i32.mul (local.get $tap) (local.get $chBytes)))
                        (v128.const i32x4 0 0 0 0)))
                    (local.set $t1 (i32.add (local.get $tap) (i32.const 1)))
                    (local.set $samples
                      (v128.load32_lane 1
                        (i32.add (local.get $chanBaseBytePtr)
                          (i32.mul (local.get $t1) (local.get $chBytes)))
                        (local.get $samples)))
                    (local.set $t2 (i32.add (local.get $tap) (i32.const 2)))
                    (local.set $samples
                      (v128.load32_lane 2
                        (i32.add (local.get $chanBaseBytePtr)
                          (i32.mul (local.get $t2) (local.get $chBytes)))
                        (local.get $samples)))
                    (local.set $t3 (i32.add (local.get $tap) (i32.const 3)))
                    (local.set $samples
                      (v128.load32_lane 3
                        (i32.add (local.get $chanBaseBytePtr)
                          (i32.mul (local.get $t3) (local.get $chBytes)))
                        (local.get $samples)))
                    (local.set $simdAcc (f32x4.add (local.get $simdAcc)
                      (f32x4.mul (local.get $samples) (local.get $fCoefs))))
                    (local.set $tap (i32.add (local.get $tap) (i32.const 4)))
                    (br $simdMultiLoop)))))

            ;; Horizontal sum of SIMD accumulator
            (local.set $sum (f64.promote_f32 (f32x4.extract_lane 0 (local.get $simdAcc))))
            (local.set $sum (f64.add (local.get $sum) (f64.promote_f32 (f32x4.extract_lane 1 (local.get $simdAcc)))))
            (local.set $sum (f64.add (local.get $sum) (f64.promote_f32 (f32x4.extract_lane 2 (local.get $simdAcc)))))
            (local.set $sum (f64.add (local.get $sum) (f64.promote_f32 (f32x4.extract_lane 3 (local.get $simdAcc)))))

            ;; Scalar remainder taps
            (local.set $remStart (local.get $simdLimit))
            (block $remDone
              (loop $remLoop
                (br_if $remDone (i32.ge_u (local.get $remStart) (local.get $fs)))
                (local.set $sIdx
                  (i32.add (local.get $sampleBase)
                    (i32.add (i32.mul (local.get $remStart) (local.get $ch)) (local.get $c))))
                (local.set $sum (f64.add (local.get $sum)
                  (f64.mul
                    (f64.promote_f32 (f32.load (i32.add (local.get $inputPtr)
                      (i32.shl (local.get $sIdx) (i32.const 2)))))
                    (f64.promote_f32 (f32.load (i32.add (local.get $ftPtr)
                      (i32.shl (i32.add (local.get $filterRow) (local.get $remStart)) (i32.const 2))))))))
                (local.set $remStart (i32.add (local.get $remStart) (i32.const 1)))
                (br $remLoop)))

            (f32.store (i32.add (local.get $outputPtr) (i32.shl (local.get $writeIdx) (i32.const 2)))
              (f32.demote_f64 (local.get $sum)))
            (local.set $writeIdx (i32.add (local.get $writeIdx) (i32.const 1)))
            (local.set $c (i32.add (local.get $c) (i32.const 1)))
            (br $chanLoop)))

        (local.set $srcPos (f64.add (local.get $srcPos) (global.get $ratio)))
        (br $outer)))

    (local.set $consume (i32.trunc_f64_s (local.get $srcPos)))
    (global.set $inputFraction (f64.sub (local.get $srcPos) (f64.convert_i32_s (local.get $consume))))
    (global.set $historyFilled
      (select (i32.sub (local.get $totalFrames) (local.get $consume)) (i32.const 0)
        (i32.gt_s (i32.sub (local.get $totalFrames) (local.get $consume)) (i32.const 0))))
    (i32.div_u (local.get $writeIdx) (local.get $ch)))

  (func (export "flush")
    (param $combinedPtr i32) (param $outputPtr i32)
    (result i32)
    (local $fs i32) (local $ch i32) (local $padFrames i32)
    (local $padElements i32) (local $hFilled i32)
    (local $zeroStart i32) (local $zeroLen i32)

    (local.set $fs (global.get $filterSize))
    (local.set $ch (global.get $channels))
    (local.set $hFilled (global.get $historyFilled))
    (if (i32.eqz (local.get $hFilled)) (then (return (i32.const 0))))
    (local.set $padFrames (local.get $fs))
    (local.set $padElements (i32.mul (local.get $padFrames) (local.get $ch)))
    (local.set $zeroStart
      (i32.add (local.get $combinedPtr)
        (i32.shl (i32.mul (local.get $hFilled) (local.get $ch)) (i32.const 2))))
    (local.set $zeroLen (i32.shl (local.get $padElements) (i32.const 2)))
    (memory.fill (local.get $zeroStart) (i32.const 0) (local.get $zeroLen))
    (call $process (local.get $combinedPtr) (local.get $padFrames) (local.get $outputPtr)))
)
