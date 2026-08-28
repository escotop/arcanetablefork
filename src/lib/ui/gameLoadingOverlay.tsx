import LoaderIcon from 'lucide-solid/icons/loader-circle';

export default function GameLoadingOverlay() {
  return (
    <div class='fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4 bg-black/70 pointer-events-auto'>
      <LoaderIcon class='size-12 text-white animate-spin' />
      <p class='text-sm text-white/80'>Cargando...</p>
    </div>
  );
}
