const room = new WebsimSocket();

// State management
const state = {
  galleryImages: [],
  currentTab: 'recent',
  currentEditId: null,
  currentSearch: '',
  currentPage: 1,
  currentUserFilter: null,
  itemsPerPage: 10
};

// Gallery initialization and subscription
async function initGallery() {
  state.galleryImages = await room.collection('gallery_images').getList();
  room.collection('gallery_images').subscribe(images => {
    state.galleryImages = images;
    renderGallery();
  });
  renderGallery();
}

// Gallery filtering and sorting utilities
const galleryFilters = {
  search: (images, searchTerm) => {
    if (!searchTerm) return images;
    const searchLower = searchTerm.toLowerCase();
    return images.filter(img => 
      img.prompt.toLowerCase().includes(searchLower) || 
      img.username.toLowerCase().includes(searchLower)
    );
  },

  userFilter: (images, username) => {
    if (!username) return images;
    return images.filter(img => {
      const isCreator = img.username === username;
      const hasModifications = img.promptHistory?.some(entry => 
        entry.username === username
      );
      return isCreator || hasModifications;
    });
  },

  tabFilter: {
    popular: (images) => [...images].sort((a, b) => (b.views || 0) - (a.views || 0)),
    my: (images, username) => images.filter(img => {
      const isOriginalCreator = img.username === username;
      const hasModifications = img.promptHistory?.some(entry => 
        entry.username === username && 
        entry.timestamp !== img.created_at
      );
      return isOriginalCreator || hasModifications;
    }),
    recent: (images) => [...images].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }
};

// Gallery rendering
function renderGallery() {
  const galleryEl = document.getElementById('gallery');
  let filteredImages = [...state.galleryImages];

  // Apply filters in sequence
  if (state.currentUserFilter) {
    filteredImages = galleryFilters.userFilter(filteredImages, state.currentUserFilter);
    updateUserFilterUI(true);
  } else {
    updateUserFilterUI(false);
  }

  if (state.currentSearch) {
    filteredImages = galleryFilters.search(filteredImages, state.currentSearch);
  }

  // Apply tab-specific filtering
  filteredImages = galleryFilters.tabFilter[state.currentTab](
    filteredImages, 
    room.party.client.username
  );

  // Pagination
  const totalPages = Math.ceil(filteredImages.length / state.itemsPerPage);
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const pageImages = filteredImages.slice(startIndex, endIndex);

  updatePaginationControls(state.currentPage, totalPages);
  renderGalleryItems(pageImages, galleryEl);
}

function updateUserFilterUI(show) {
  const filterInfo = document.getElementById('userFilterInfo');
  if (show) {
    filterInfo.style.display = 'flex';
    document.getElementById('userFilterName').textContent = state.currentUserFilter;
  } else {
    filterInfo.style.display = 'none';
  }
}

function renderGalleryItems(images, container) {
  if (images.length === 0) {
    container.innerHTML = `
      <div class="no-results">
        ${getNoResultsMessage()}
      </div>
    `;
    return;
  }

  container.innerHTML = images.map(img => createGalleryItemHTML(img)).join('');
}

function createGalleryItemHTML(img) {
  return `
    <div class="gallery-item">
      <img src="${img.imageUrl}" alt="${img.prompt}" onclick="loadGalleryImage('${img.id}')">
      <div class="metadata">
        <div>${img.prompt}</div>
        <div>by ${img.username}</div>
        <div>${new Date(img.created_at).toLocaleDateString()}</div>
      </div>
      <div class="stats">
        <span>${img.views || 0} views</span>
        <span>${img.uses || 0} uses</span>
      </div>
      ${img.username === room.party.client.username ? `
        <div class="gallery-item-controls">
          <button class="edit-button" onclick="editImage('${img.id}')">Edit</button>
          <button class="delete-button" onclick="deleteImage('${img.id}')">Delete</button>
        </div>
      ` : ''}
    </div>
  `;
}

// Gallery item interaction handlers
async function loadGalleryImage(id) {
  const image = state.galleryImages.find(img => img.id === id);
  if (!image) return;
  
  await updateImageStats(id, image);
  await loadImageIntoEditor(image);
}

async function updateImageStats(id, image) {
  return room.collection('gallery_images').update(id, {
    views: (image.views || 0) + 1,
    uses: (image.uses || 0) + 1
  });
}

async function handleImageModification(sourceImage, newImageUrl, modificationDetails) {
  const promptHistory = buildPromptHistory(sourceImage, modificationDetails);
  
  await createModifiedImageRecord(sourceImage, newImageUrl, promptHistory);
  await updateSourceImageUses(sourceImage);
}

// Utility functions
function buildPromptHistory(sourceImage, newEntry) {
  const baseHistory = sourceImage.promptHistory || [{
    prompt: sourceImage.prompt,
    timestamp: sourceImage.created_at,
    username: sourceImage.username
  }];
  
  return [...baseHistory, {
    ...newEntry,
    timestamp: new Date().toISOString(),
    username: room.party.client.username
  }];
}

function getNoResultsMessage() {
  if (state.currentUserFilter) return 'No images found by this user';
  if (state.currentSearch) return 'No images found matching your search';
  return 'No images available';
}

function updatePaginationControls(currentPage, totalPages) {
  document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('prevPage').disabled = currentPage === 1;
  document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

async function showGalleryTab(tab) {
  state.currentTab = tab;
  state.currentPage = 1; // Reset to first page when changing tabs
  document.querySelectorAll('.gallery-tab').forEach(el => {
    el.classList.toggle('active', el.textContent.toLowerCase().includes(tab));
  });
  renderGallery();
}

async function editImage(id) {
  const image = state.galleryImages.find(img => img.id === id);
  if (!image) return;
  state.currentEditId = id;
  const dialog = document.getElementById('editPromptDialog');
  const overlay = document.getElementById('overlay');
  const input = document.getElementById('editPromptInput');
  input.value = image.prompt;
  dialog.style.display = 'block';
  overlay.style.display = 'block';
}

async function saveEdit() {
  if (!state.currentEditId) return;
  const input = document.getElementById('editPromptInput');
  const newPrompt = input.value.trim();
  if (!newPrompt) {
    alert('Please enter a prompt');
    return;
  }
  await room.collection('gallery_images').update(state.currentEditId, {
    prompt: newPrompt
  });
  cancelEdit();
}

function cancelEdit() {
  state.currentEditId = null;
  const dialog = document.getElementById('editPromptDialog');
  const overlay = document.getElementById('overlay');
  const input = document.getElementById('editPromptInput');
  input.value = '';
  dialog.style.display = 'none';
  overlay.style.display = 'none';
}

async function deleteImage(id) {
  if (!confirm('Are you sure you want to delete this image?')) return;
  await room.collection('gallery_images').delete(id);
}

function filterGallery() {
  const searchInput = document.getElementById('gallerySearch');
  state.currentSearch = searchInput.value.trim();
  state.currentPage = 1; // Reset to first page when filtering
  renderGallery();
}

function changePage(delta) {
  const newPage = state.currentPage + delta;
  const totalPages = Math.ceil(state.galleryImages.length / state.itemsPerPage);
  
  if (newPage >= 1 && newPage <= totalPages) {
    state.currentPage = newPage;
    renderGallery();
  }
}

async function createModifiedImageRecord(sourceImage, newImageUrl, promptHistory) {
  return room.collection('gallery_images').create({
    prompt: sourceImage.prompt,
    imageUrl: newImageUrl,
    created_at: new Date().toISOString(),
    views: 0,
    uses: 0,
    promptHistory
  });
}

async function updateSourceImageUses(sourceImage) {
  return room.collection('gallery_images').update(sourceImage.id, {
    uses: (sourceImage.uses || 0) + 1
  });
}

async function loadImageIntoEditor(image) {
  const imageContainer = document.getElementById('imageContainer');
  const existingImages = imageContainer.querySelectorAll('img');
  existingImages.forEach(img => img.remove());
  
  const generatedImage = document.createElement('img');
  generatedImage.id = `generatedImage_${imageCounter++}`;
  generatedImage.className = 'generated-image';
  generatedImage.style.display = 'none';
  generatedImage.crossOrigin = 'anonymous';
  generatedImage.src = image.imageUrl;
  generatedImage.alt = image.prompt;
  
  imageContainer.appendChild(generatedImage);
  
  document.getElementById('saveButton').style.display = 'block';
  document.getElementById('addGalleryButton').style.display = 'block';
  
  generatedImage.onload = function () {
    setupImageEditor();
  };
}

let imageCounter = 0;

function setupImageEditor() {
  // Setup image editor logic here
}