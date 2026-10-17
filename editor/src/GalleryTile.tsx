import {memo, useEffect, useRef, useState, type RefObject} from 'react';
import {Check, ImagePlus, Trash2, X} from 'lucide-react';
import {t, useLanguage} from './i18n';
import type {StoredPhoto} from './storage';
import {canMakeGalleryThumbnail, galleryThumbnail} from './gallery-thumbnail';

export interface GalleryActions { select(id: string): void; remove(id: string): void }

interface Props {
  photo: StoredPhoto;
  selected: boolean;
  selectionDisabled: boolean;
  removalDisabled: boolean;
  actions: RefObject<GalleryActions>;
}

function GalleryTile({photo, selected, selectionDisabled, removalDisabled, actions}: Props) {
  useLanguage();
  const tile = useRef<HTMLDivElement>(null);
  const [nearView, setNearView] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [photo.thumbnail, generated]);
  useEffect(() => {
    const element = tile.current;
    if (!element || photo.thumbnail || !canMakeGalleryThumbnail(photo.file)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearView(true); observer.disconnect(); }
    }, {rootMargin: '120px'});
    observer.observe(element);
    return () => observer.disconnect();
  }, [photo.file, photo.thumbnail]);
  useEffect(() => {
    if (!nearView || photo.thumbnail || !canMakeGalleryThumbnail(photo.file)) return;
    const controller = new AbortController();
    void galleryThumbnail(photo.file, controller.signal).then(result => {
      if (!controller.signal.aborted && result) setGenerated(result);
    });
    return () => controller.abort();
  }, [nearView, photo.file, photo.thumbnail]);
  const image = imageFailed ? null : photo.thumbnail ?? generated;
  return <div ref={tile} className={`photo-tile ${selected ? 'selected' : ''}`}>
    <button className="photo-select" disabled={selectionDisabled} onClick={() => actions.current.select(photo.id)} title={photo.file.name}>
      {image ? <img src={image} alt={photo.file.name} loading="lazy" decoding="async" onError={() => setImageFailed(true)}/> : <ImagePlus className="gallery-placeholder" size={22} aria-hidden="true"/>}
      {selected && <span className="selected-check"><Check size={12}/></span>}
      <span>{photo.file.name.replace(/\.[^.]+$/, '')}</span>
    </button>
    <button className="remove-photo" disabled={removalDisabled} title={photo.nativeCapture?t('Remove camera capture'):photo.cameraCapture?t('Delete camera photo'):t('Remove local copy')} aria-label={t(photo.nativeCapture?'Remove {0}':photo.cameraCapture?'Delete {0}':'Remove {0}',[photo.file.name])} onClick={() => actions.current.remove(photo.id)}>{photo.nativeCapture||photo.cameraCapture?<Trash2 size={12}/>:<X size={12}/>}</button>
  </div>;
}

export default memo(GalleryTile);
